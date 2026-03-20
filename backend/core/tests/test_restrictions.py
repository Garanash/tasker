import uuid

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    Board,
    Card,
    Checklist,
    ChecklistItem,
    Column,
    Organization,
    OrganizationMember,
    Project,
    RestrictionRule,
    Space,
    Track,
    WipLimit,
)


def auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


class RestrictionMoveTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Org1")
        self.space = Space.objects.create(organization=self.org, name="Space1")
        self.project = Project.objects.create(space=self.space, name="Project1")
        self.board = Board.objects.create(space=self.space, project=self.project, name="Board1")

        self.col_todo = Column.objects.create(board=self.board, name="ToDo", order_index=0, is_done=False)
        self.col_done = Column.objects.create(board=self.board, name="Done", order_index=1, is_done=True)
        self.col_other = Column.objects.create(board=self.board, name="Other", order_index=2, is_done=False)

        self.track_main = Track.objects.create(board=self.board, name="Main", order_index=0)

        from core.models import User

        self.user = User.objects.create_user(email="u1@test.com", password="password123", full_name="")
        OrganizationMember.objects.create(organization=self.org, user=self.user, role=OrganizationMember.Role.ADMIN)

        self.client = auth_client(self.user)

    def test_wip_limit_blocks_move(self):
        # WIP limit: only 1 card allowed in ToDo
        WipLimit.objects.create(
            organization=self.org,
            board=self.board,
            scope_type="column",
            column=self.col_todo,
            limit=1,
        )

        card1 = Card.objects.create(
            board=self.board,
            column=self.col_done,
            track=self.track_main,
            title="c1",
            description="",
        )
        card2 = Card.objects.create(
            board=self.board,
            column=self.col_done,
            track=self.track_main,
            title="c2",
            description="",
        )

        # 1) Move first card into ToDo => allowed
        res1 = self.client.post(
            f"/api/kanban/cards/{card1.id}/move",
            {"to_column_id": str(self.col_todo.id), "to_track_id": None},
            format="json",
        )
        self.assertEqual(res1.status_code, 200)

        # 2) Move second card into ToDo => should be blocked by WIP
        res2 = self.client.post(
            f"/api/kanban/cards/{card2.id}/move",
            {"to_column_id": str(self.col_todo.id), "to_track_id": None},
            format="json",
        )
        self.assertEqual(res2.status_code, 400)
        self.assertEqual(res2.data.get("code"), "wip_exceeded")

    def test_previous_path_rule_blocks(self):
        # Allow move into Done only from ToDo column
        rule = RestrictionRule.objects.create(
            organization=self.org,
            board=self.board,
            to_column=self.col_done,
            condition_type=RestrictionRule.ConditionType.PREVIOUS_PATH,
            deny_action=RestrictionRule.DenyAction.MOVE_CARD,
            params={"allowed_previous_column_ids": [str(self.col_todo.id)]},
        )

        card = Card.objects.create(
            board=self.board,
            column=self.col_other,
            track=self.track_main,
            title="child",
            description="",
        )

        res = self.client.post(
            f"/api/kanban/cards/{card.id}/move",
            {"to_column_id": str(self.col_done.id), "to_track_id": None},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data.get("code"), "previous_path_violation")

    def test_unfinished_children_blocks(self):
        # Rule applies when moving into Done
        RestrictionRule.objects.create(
            organization=self.org,
            board=self.board,
            to_column=self.col_done,
            condition_type=RestrictionRule.ConditionType.UNFINISHED_CHILDREN,
            deny_action=RestrictionRule.DenyAction.MOVE_CARD,
            params={},
        )

        parent = Card.objects.create(
            board=self.board,
            column=self.col_other,
            track=self.track_main,
            title="parent",
            description="",
        )
        child = Card.objects.create(
            board=self.board,
            column=self.col_todo,  # not done
            track=self.track_main,
            title="child",
            description="",
            parent=parent,
        )

        res = self.client.post(
            f"/api/kanban/cards/{parent.id}/move",
            {"to_column_id": str(self.col_done.id), "to_track_id": None},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data.get("code"), "unfinished_children")

    def test_not_completed_checklists_blocks(self):
        RestrictionRule.objects.create(
            organization=self.org,
            board=self.board,
            to_column=self.col_done,
            condition_type=RestrictionRule.ConditionType.NOT_COMPLETED_CHECKLISTS,
            deny_action=RestrictionRule.DenyAction.MOVE_CARD,
            params={},
        )

        card = Card.objects.create(
            board=self.board,
            column=self.col_other,
            track=self.track_main,
            title="card",
            description="",
        )
        checklist = Checklist.objects.create(card=card, title="cl")
        ChecklistItem.objects.create(checklist=checklist, title="i1", is_done=False)

        res = self.client.post(
            f"/api/kanban/cards/{card.id}/move",
            {"to_column_id": str(self.col_done.id), "to_track_id": None},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data.get("code"), "checklists_not_completed")

