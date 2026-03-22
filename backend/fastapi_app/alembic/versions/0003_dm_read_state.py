from alembic import op


revision = "0003_dm_read_state"
down_revision = "0002_executor_acl"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core_dm_read_state (
            user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
            organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
            peer_user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
            last_read_at timestamptz NOT NULL DEFAULT to_timestamp(0),
            PRIMARY KEY (user_id, organization_id, peer_user_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS core_dm_read_state_org_user_idx ON core_dm_read_state (organization_id, user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core_dm_read_state")
