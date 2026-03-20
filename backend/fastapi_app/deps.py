"""Зависимости FastAPI: JWT, RBAC."""
from __future__ import annotations

from fastapi import HTTPException, Request
from jose import JWTError, jwt
from starlette import status

from . import state


def _get_bearer_token(headers: dict[str, str]) -> str | None:
    auth = headers.get("authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    return auth.split(" ", 1)[1].strip()


def _get_active_space_id(headers: dict[str, str]) -> str | None:
    return headers.get("x-space-id")


def _decode_jwt_user_id(token: str | None) -> str | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, state.SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("user_id")
        return str(user_id) if user_id else None
    except JWTError:
        return None


async def _has_space_access(user_id: str, space_id: str) -> bool:
    if not state.pg_pool:
        return False
    q = """
        SELECT 1
        FROM core_space s
        JOIN core_organizationmember om ON om.organization_id = s.organization_id
        WHERE s.id = $1 AND om.user_id = $2
        LIMIT 1
    """
    row = await state.pg_pool.fetchrow(q, space_id, user_id)
    return bool(row)


async def require_authenticated_user_id(request: Request) -> str:
    token = _get_bearer_token(dict(request.headers))
    user_id = _decode_jwt_user_id(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token")
    return user_id


async def require_space_access(request: Request) -> None:
    token = _get_bearer_token(dict(request.headers))
    user_id = _decode_jwt_user_id(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token")
    space_id = _get_active_space_id(dict(request.headers))
    if not space_id:
        return
    ok = await _has_space_access(user_id=user_id, space_id=space_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="space_forbidden")


ROLE_PRIORITY = {
    "user": 1,
    "manager": 2,
    "support": 2,
    "lead": 3,
    "admin": 4,
}


async def _resolve_organization_id(request: Request, user_id: str) -> str:
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    space_id = _get_active_space_id(dict(request.headers))
    if space_id:
        row = await state.pg_pool.fetchrow(
            """
            SELECT s.organization_id
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE s.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            space_id,
            user_id,
        )
        if row:
            return str(row["organization_id"])
    row = await state.pg_pool.fetchrow(
        """
        SELECT organization_id
        FROM core_organizationmember
        WHERE user_id = $1::uuid
        ORDER BY created_at
        LIMIT 1
        """,
        user_id,
    )
    if not row:
        raise HTTPException(status_code=403, detail="organization_forbidden")
    return str(row["organization_id"])


async def get_effective_role(user_id: str, organization_id: str) -> str:
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    memberships = await state.pg_pool.fetch(
        """
        SELECT role
        FROM core_organizationmember
        WHERE user_id = $1::uuid AND organization_id = $2::uuid
        """,
        user_id,
        organization_id,
    )
    group_roles = await state.pg_pool.fetch(
        """
        SELECT g.role
        FROM core_groupmembership gm
        JOIN core_usergroup g ON g.id = gm.group_id
        WHERE gm.user_id = $1::uuid AND gm.organization_id = $2::uuid
        """,
        user_id,
        organization_id,
    )
    roles = [str(r["role"]) for r in memberships] + [str(r["role"]) for r in group_roles]
    if not roles:
        raise HTTPException(status_code=403, detail="organization_forbidden")
    best = max(roles, key=lambda role: ROLE_PRIORITY.get(role, 0))
    return best


async def require_min_role(request: Request, min_role: str) -> str:
    token = _get_bearer_token(dict(request.headers))
    user_id = _decode_jwt_user_id(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token")
    org_id = await _resolve_organization_id(request, user_id)
    role = await get_effective_role(user_id, org_id)
    if ROLE_PRIORITY.get(role, 0) < ROLE_PRIORITY.get(min_role, 0):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_role")
    return role


async def require_manager_role(request: Request) -> str:
    return await require_min_role(request, "manager")


async def require_lead_role(request: Request) -> str:
    return await require_min_role(request, "lead")


async def require_admin_role(request: Request) -> str:
    return await require_min_role(request, "admin")
