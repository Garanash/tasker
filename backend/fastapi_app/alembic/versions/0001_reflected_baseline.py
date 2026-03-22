from alembic import op


# revision identifiers, used by Alembic.
revision = "0001_reflected_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Foundation/subset mode: таблицы уже существуют в БД (исторически или из init.sql),
    # поэтому на этом шаге делаем базовую отметку.
    pass


def downgrade() -> None:
    # Понижение базовой отметки не поддерживается в foundation-режиме.
    pass

