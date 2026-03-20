from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import Organization, OrganizationMember, Ticket, User


def auth_client(user: User) -> APIClient:
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


class ServiceDeskSmokeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="OrgSD")
        self.user = User.objects.create_user(email="sd@test.com", password="password123", full_name="SD User")
        OrganizationMember.objects.create(organization=self.org, user=self.user, role=OrganizationMember.Role.ADMIN)
        self.client = auth_client(self.user)

    def test_internal_ticket_flow(self):
        res = self.client.post(
            "/api/service-desk/tickets",
            {
                "title": "Internal issue",
                "description": "Desc",
                "priority": 1,
                "requester_name": "Requester",
                "requester_email": "r@test.com",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        ticket_id = res.data["id"]

        res_comment = self.client.post(
            f"/api/service-desk/tickets/{ticket_id}/comments",
            {"body": "First comment"},
            format="json",
        )
        self.assertEqual(res_comment.status_code, 201)

        res_patch = self.client.patch(
            f"/api/service-desk/tickets/{ticket_id}",
            {"status": Ticket.Status.RESOLVED, "assigned_to_id": None},
            format="json",
        )
        self.assertEqual(res_patch.status_code, 200)
        self.assertEqual(res_patch.data["status"], Ticket.Status.RESOLVED)

        res_rating = self.client.post(
            f"/api/service-desk/tickets/{ticket_id}/rating",
            {"score": 5, "comment": "Great"},
            format="json",
        )
        self.assertEqual(res_rating.status_code, 201)
        self.assertEqual(res_rating.data["score"], 5)

    def test_public_token_flow(self):
        res_create = self.client.post(
            "/api/service-desk/public/tickets",
            {
                "organization_id": str(self.org.id),
                "requester_name": "External",
                "requester_email": "ext@test.com",
                "title": "External issue",
                "description": "Hello",
            },
            format="json",
        )
        # endpoint AllowAny => ok, но client с auth тоже работает
        self.assertEqual(res_create.status_code, 201)
        ticket_id = res_create.data["ticket"]["id"]
        token1 = res_create.data["public_token"]

        res_get = self.client.get(
            f"/api/service-desk/public/tickets/{ticket_id}",
            HTTP_X_PUBLIC_TOKEN=token1,
        )
        self.assertEqual(res_get.status_code, 200)
        self.assertIn("next_public_token", res_get.data)
        token2 = res_get.data["next_public_token"]

        res_comment = self.client.post(
            f"/api/service-desk/public/tickets/{ticket_id}/comments",
            {"body": "External reply"},
            HTTP_X_PUBLIC_TOKEN=token2,
            format="json",
        )
        self.assertEqual(res_comment.status_code, 201)
        self.assertIn("next_public_token", res_comment.data)

        token3 = res_comment.data["next_public_token"]
        res_rating_public = self.client.post(
            f"/api/service-desk/public/tickets/{ticket_id}/rating",
            {"score": 4, "comment": "Thanks"},
            HTTP_X_PUBLIC_TOKEN=token3,
            format="json",
        )
        self.assertEqual(res_rating_public.status_code, 201)
        self.assertEqual(res_rating_public.data["rating"]["score"], 4)

