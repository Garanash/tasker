from alembic import op


# revision identifiers, used by Alembic.
revision = "0002_executor_acl"
down_revision = "0001_reflected_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core_cardassignment (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
            assigned_by_id uuid REFERENCES core_user(id) ON DELETE SET NULL,
            assigned_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(card_id, user_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS core_cardassignment_user_idx ON core_cardassignment(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS core_cardassignment_card_idx ON core_cardassignment(card_id)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core_cardcommentreadstate (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
            last_seen_comment_at timestamptz NOT NULL DEFAULT to_timestamp(0),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(card_id, user_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS core_cardcommentreadstate_user_idx ON core_cardcommentreadstate(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS core_cardcommentreadstate_card_idx ON core_cardcommentreadstate(card_id)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core_commentattachmentlink (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            comment_id uuid NOT NULL REFERENCES core_cardcomment(id) ON DELETE CASCADE,
            attachment_id uuid NOT NULL REFERENCES core_attachment(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(comment_id, attachment_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core_commentattachmentlink")
    op.execute("DROP TABLE IF EXISTS core_cardcommentreadstate")
    op.execute("DROP TABLE IF EXISTS core_cardassignment")
