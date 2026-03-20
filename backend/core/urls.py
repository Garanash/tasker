from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView

from core.views import (
    AuthHealthView,
    GroupsView,
    LoginView,
    MeView,
    RefreshView,
    RegisterView,
    RestrictionsRulesView,
    SpacesView,
    AutomationsRulesView,
)
from core.kanban_views import (
    BoardGridView,
    BoardsView,
    BootstrapKanbanView,
    CardAttachmentsView,
    CardCommentsView,
    CardDetailView,
    MoveCardView,
)
from core.scrum_views import GanttBoardPlanView, ScrumSprintsView, SprintCapacitiesView, SprintMetricsView
from core.analytics_views import KanbanAnalyticsView, ScrumAnalyticsView, SummaryAnalyticsView
from core.time_views import (
    TimeEntryDetailView,
    TimeEntryStartView,
    TimeEntryStopView,
    TimeEntriesView,
    TimeReportView,
)
from core.service_desk_views import (
    PublicTicketCommentsView,
    PublicTicketDetailView,
    PublicTicketsView,
    TemplatesView,
    TicketsView,
    PublicTicketRatingView,
    TicketCommentsView,
    TicketDetailView,
    TicketRatingView,
)
from core.documents_views import DocumentDetailView, DocumentsView


urlpatterns = [
    # Health для интеграции
    path("auth/health", AuthHealthView.as_view()),
    path("auth/register", RegisterView.as_view()),
    path("auth/login", LoginView.as_view()),
    path("auth/refresh", RefreshView.as_view()),
    path("auth/me", MeView.as_view()),
    path("auth/spaces", SpacesView.as_view()),
    path("auth/groups", GroupsView.as_view()),

    # Kanban
    path("kanban/boards", BoardsView.as_view()),
    path("kanban/bootstrap", BootstrapKanbanView.as_view()),
    path("kanban/boards/<uuid:board_id>/grid", BoardGridView.as_view()),
    path("kanban/cards/<uuid:card_id>", CardDetailView.as_view()),
    path("kanban/cards/<uuid:card_id>/comments", CardCommentsView.as_view()),
    path("kanban/cards/<uuid:card_id>/attachments", CardAttachmentsView.as_view()),
    path("kanban/cards/<uuid:card_id>/move", MoveCardView.as_view()),

    # Restrictions
    path("restrictions/rules", RestrictionsRulesView.as_view()),

    # Automation
    path("automation/rules", AutomationsRulesView.as_view()),

    # Scrum / Gantt (MVP)
    path("scrum/sprints", ScrumSprintsView.as_view()),
    path("scrum/sprints/<uuid:sprint_id>/metrics", SprintMetricsView.as_view()),
    path("scrum/sprints/<uuid:sprint_id>/capacities", SprintCapacitiesView.as_view()),
    path("gantt/boards/<uuid:board_id>/plan", GanttBoardPlanView.as_view()),

    # Analytics reports (MVP)
    path("analytics/summary", SummaryAnalyticsView.as_view()),
    path("analytics/kanban/boards/<uuid:board_id>", KanbanAnalyticsView.as_view()),
    path("analytics/scrum/sprints/<uuid:sprint_id>/metrics", ScrumAnalyticsView.as_view()),

    # Time tracking (MVP)
    path("time/entries/start", TimeEntryStartView.as_view()),
    path("time/entries/stop", TimeEntryStopView.as_view()),
    path("time/entries", TimeEntriesView.as_view()),
    path("time/entries/<uuid:entry_id>", TimeEntryDetailView.as_view()),
    path("time/reports", TimeReportView.as_view()),

    # Service Desk (MVP)
    path("service-desk/templates", TemplatesView.as_view()),
    path("service-desk/tickets", TicketsView.as_view()),
    path("service-desk/tickets/<uuid:ticket_id>", TicketDetailView.as_view()),
    path("service-desk/tickets/<uuid:ticket_id>/comments", TicketCommentsView.as_view()),

    # Public (external)
    path("service-desk/public/tickets", PublicTicketsView.as_view()),
    path("service-desk/public/tickets/<uuid:ticket_id>", PublicTicketDetailView.as_view()),
    path("service-desk/public/tickets/<uuid:ticket_id>/comments", PublicTicketCommentsView.as_view()),
    path("service-desk/tickets/<uuid:ticket_id>/rating", TicketRatingView.as_view()),
    path("service-desk/public/tickets/<uuid:ticket_id>/rating", PublicTicketRatingView.as_view()),

    # Documents / Knowledge base (MVP)
    path("docs", DocumentsView.as_view()),
    path("docs/<uuid:document_id>", DocumentDetailView.as_view()),
]

