"""Нормализация ролей: только executor, manager, admin (старые user/lead/support → новые значения)."""

from alembic import op


revision = "0004_normalize_org_roles"
down_revision = "0003_dm_read_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE core_organizationmember SET role = 'executor' WHERE lower(role) IN ('user', 'support')"
    )
    op.execute("UPDATE core_organizationmember SET role = 'manager' WHERE lower(role) = 'lead'")
    op.execute("UPDATE core_usergroup SET role = 'executor' WHERE lower(role) IN ('user', 'support')")
    op.execute("UPDATE core_usergroup SET role = 'manager' WHERE lower(role) = 'lead'")


def downgrade() -> None:
    pass
