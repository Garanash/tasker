from __future__ import annotations

from typing import Dict

from sqlalchemy import MetaData, Table

from .db import get_engine


CORE_TABLES = [
    "core_user",
    "core_organization",
    "core_organizationmember",
    "core_usergroup",
    "core_groupmembership",
    "core_space",
    "core_project",
    "core_board",
    "core_column",
    "core_track",
    "core_card",
    "core_tag",
    "core_cardtag",
    "core_checklist",
    "core_checklistitem",
    "core_attachment",
    "core_document",
    "core_cardfielddefinition",
    "core_cardfieldvalue",
    "core_cardrelation",
    "core_cardblock",
    "core_cardcomment",
    "core_cardmovementevent",
    "core_wiplimit",
    "core_restrictionrule",
    "core_automationrule",
    "core_automationexecution",
    # служебные для будущего порта
    "core_sprint",
    "core_sprintcapacity",
    "core_timeentry",
    "core_servicedeskslapolicy",
    "core_ticket",
    "core_ticketcomment",
    "core_tickettemplate",
    "core_ticketrating",
    "core_ticketpublicaccess",
]


_metadata = MetaData()
_tables: Dict[str, Table] | None = None


def reflect_core_tables() -> Dict[str, Table]:
    global _tables
    if _tables is not None:
        return _tables

    engine = get_engine()
    tables: Dict[str, Table] = {}
    for name in CORE_TABLES:
        tables[name] = Table(name, _metadata, autoload_with=engine)
    _tables = tables
    return tables


def get_target_metadata() -> MetaData:
    """
    Alembic использует target_metadata для autogenerate.
    Мы подмешиваем сюда reflection-таблицы, чтобы миграции были согласованы с текущей схемой.
    """
    reflect_core_tables()
    return _metadata


def get_table(name: str) -> Table:
    tables = reflect_core_tables()
    if name not in tables:
        raise KeyError(f"Unknown table for reflection: {name}")
    return tables[name]

