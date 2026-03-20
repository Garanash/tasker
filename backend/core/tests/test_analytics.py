import uuid
from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    Board,
    Card,
    CardBlock,
    CardMovementEvent,
    Column,
    Organization,
    OrganizationMember,
    Project,
    Sprint,
    Space,
    Track,
    User,
)


def auth_client(user: User) -> APIClient:
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


class AnalyticsSmokeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Org1")
        self.space = Space.objects.create(organization=self.org, name="Space1")
        self.project = Project.objects.create(space=self.space, name="Project1")
        self.board = Board.objects.create(space=self.space, project=self.project, name="Board1")

        self.col_todo = Column.objects.create(board=self.board, name="ToDo", order_index=0, is_done=False)
        self.col_done = Column.objects.create(board=self.board, name="Done", order_index=1, is_done=True)

        self.track_main = Track.objects.create(board=self.board, name="Main", order_index=0)

        self.user = User.objects.create_user(email="u1@test.com", password="password123", full_name="Test User")
        OrganizationMember.objects.create(organization=self.org, user=self.user, role=OrganizationMember.Role.ADMIN)

        self.client = auth_client(self.user)

    def test_kanban_analytics(self):
        card = Card.objects.create(
            board=self.board,
            column=self.col_todo,
            track=self.track_main,
            title="card-1",
            description="",
            estimate_points=3,
        )

        # Блокировка (для block-time метрик)
        block = CardBlock.objects.create(
            card=card,
            blocked_by=self.user,
            reason="",
            is_resolved=True,
            resolved_at=timezone.now() - timedelta(hours=1),
        )
        # created_at поставим в прошлое, чтобы разница была > 0
        CardBlock.objects.filter(id=block.id).update(created_at=timezone.now() - timedelta(hours=3))

        res_move = self.client.post(
            f"/api/kanban/cards/{card.id}/move",
            {"to_column_id": str(self.col_done.id), "to_track_id": None},
            format="json",
        )
        self.assertEqual(res_move.status_code, 200)

        res = self.client.get(f"/api/analytics/kanban/boards/{self.board.id}?days=1")
        self.assertEqual(res.status_code, 200)
        data = res.data

        self.assertIn("metrics", data)
        self.assertIn("throughput", data)
        self.assertIn("cfd", data)
        self.assertEqual(data["metrics"]["done_cards_total"], 1)

        # block time должен присутствовать (может быть 0, если timing слишком близкий).
        self.assertIn("block_time_avg_hours", data["metrics"])

    def test_summary_analytics(self):
        card = Card.objects.create(
            board=self.board,
            column=self.col_todo,
            track=self.track_main,
            title="card-1",
            description="",
        )
        res_move = self.client.post(
            f"/api/kanban/cards/{card.id}/move",
            {"to_column_id": str(self.col_done.id), "to_track_id": None},
            format="json",
        )
        self.assertEqual(res_move.status_code, 200)

        res = self.client.get("/api/analytics/summary?days=1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["summary"]["done_cards_total"], 1)

    def test_scrum_analytics_proxy(self):
        card = Card.objects.create(
            board=self.board,
            column=self.col_todo,
            track=self.track_main,
            title="card-1",
            description="",
        )
        self.client.post(
            f"/api/kanban/cards/{card.id}/move",
            {"to_column_id": str(self.col_done.id), "to_track_id": None},
            format="json",
        )

        sprint = Sprint.objects.create(
            organization=self.org,
            board=self.board,
            name="Sprint1",
            goal="",
            start_at=timezone.now() - timedelta(days=1),
            end_at=timezone.now() + timedelta(days=1),
        )

        res = self.client.get(f"/api/analytics/scrum/sprints/{sprint.id}/metrics")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["velocity_cards"], 1)

