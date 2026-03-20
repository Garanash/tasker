from datetime import timedelta, datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    Board,
    Card,
    CardBlock,
    Column,
    Organization,
    OrganizationMember,
    Project,
    Space,
    Sprint,
    TimeEntry,
    Track,
    User,
)


def auth_client(user: User) -> APIClient:
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


class TimeTrackingSmokeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Org1")
        self.space = Space.objects.create(organization=self.org, name="Space1")
        self.project = Project.objects.create(space=self.space, name="Project1")
        self.board = Board.objects.create(space=self.space, project=self.project, name="Board1")

        self.col_todo = Column.objects.create(board=self.board, name="ToDo", order_index=0, is_done=False)
        self.track_main = Track.objects.create(board=self.board, name="Main", order_index=0)

        self.user = User.objects.create_user(email="u1@test.com", password="password123", full_name="Test User")
        OrganizationMember.objects.create(organization=self.org, user=self.user, role=OrganizationMember.Role.ADMIN)

        self.client = auth_client(self.user)

        self.card = Card.objects.create(
            board=self.board,
            column=self.col_todo,
            track=self.track_main,
            title="card-1",
            description="",
        )

    def test_start_stop_and_edit(self):
        start_res = self.client.post(
            "/api/time/entries/start",
            {"card_id": str(self.card.id), "note": "demo"},
            format="json",
        )
        self.assertEqual(start_res.status_code, 201)
        entry_id = start_res.data["id"]

        stop_res = self.client.post(
            "/api/time/entries/stop",
            {"entry_id": entry_id},
            format="json",
        )
        self.assertEqual(stop_res.status_code, 200)
        self.assertIsNotNone(stop_res.data["ended_at"])
        self.assertGreaterEqual(stop_res.data["duration_seconds"], 0)

        # Редактирование задним числом
        new_end = timezone.now() - timedelta(hours=1)
        new_start = new_end - timedelta(minutes=30)
        patch_res = self.client.patch(
            f"/api/time/entries/{entry_id}",
            {"started_at": new_start.isoformat(), "ended_at": new_end.isoformat(), "note": "edited"},
            format="json",
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertEqual(patch_res.data["note"], "edited")
        self.assertGreater(patch_res.data["duration_seconds"], 0)

    def test_report(self):
        start_res = self.client.post(
            "/api/time/entries/start",
            {"card_id": str(self.card.id), "note": ""},
            format="json",
        )
        entry_id = start_res.data["id"]
        self.client.post("/api/time/entries/stop", {"entry_id": entry_id}, format="json")

        res = self.client.get("/api/time/reports?group_by=card")
        self.assertEqual(res.status_code, 200)
        self.assertIn("items", res.data)
        self.assertTrue(len(res.data["items"]) >= 1)

