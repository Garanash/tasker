"""
Отправка писем через SMTP (Mail.ru и др.). Секреты только из переменных окружения.
"""
from __future__ import annotations

import asyncio
import logging
from html import escape as html_escape
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)

# Шаблоны через .format(), без f-строк: так не возникает коллизий имён (например, с «html»).
_REGISTRATION_WELCOME_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:28px;">
    <h1 style="font-size:22px;margin:0 0 12px;color:#fff;">Спасибо за регистрацию</h1>
    <p style="color:#a0a0a0;font-size:15px;line-height:1.5;">Здравствуйте, <strong style="color:#e0e0e0;">{safe_display}</strong>!</p>
    <p style="color:#a0a0a0;font-size:15px;line-height:1.5;">Ваш аккаунт в <strong style="color:#ce93d8;">AGB Tasks</strong> создан.</p>
    <table style="width:100%;margin:20px 0;font-size:14px;color:#a0a0a0;">
      <tr><td style="padding:6px 0;">Организация</td><td style="color:#e0e0e0;text-align:right;">{safe_org}</td></tr>
      <tr><td style="padding:6px 0;">Email</td><td style="color:#e0e0e0;text-align:right;">{safe_email}</td></tr>
    </table>
    <p style="color:#707070;font-size:13px;margin-top:24px;">С уважением,<br/>Администратор системы</p>
  </div>
</body></html>"""

_LOGIN_OTP_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:28px;">
    <h1 style="font-size:22px;margin:0 0 12px;color:#fff;">Код для входа</h1>
    <p style="color:#a0a0a0;font-size:15px;">Здравствуйте, <strong style="color:#e0e0e0;">{safe_display}</strong>!</p>
    <p style="color:#a0a0a0;font-size:15px;">Используйте этот код вместо пароля (действителен 15 минут):</p>
    <div style="margin:24px 0;padding:16px 24px;background:linear-gradient(90deg,#2d1f3d,#1a1025);border-radius:12px;
                text-align:center;font-size:28px;letter-spacing:8px;font-weight:800;color:#e1bee7;border:1px solid #6a1b9a;">
      {safe_code}
    </div>
    <p style="color:#707070;font-size:13px;">Если вы не запрашивали код — проигнорируйте письмо.<br/>Администратор системы</p>
  </div>
</body></html>"""

_PASSWORD_RESET_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:28px;">
    <h1 style="font-size:22px;margin:0 0 12px;color:#fff;">Сброс пароля</h1>
    <p style="color:#a0a0a0;font-size:15px;">Здравствуйте, <strong style="color:#e0e0e0;">{safe_display}</strong>!</p>
    <p style="color:#a0a0a0;font-size:15px;">Чтобы задать новый пароль для AGB Tasks, перейдите по ссылке (действительна 1 час):</p>
    <p style="margin:24px 0;">
      <a href="{safe_link}" style="display:inline-block;padding:14px 24px;background:linear-gradient(90deg,#8a2be2,#4b0082);
         color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">Установить новый пароль</a>
    </p>
    <p style="color:#707070;font-size:12px;word-break:break-all;">Если кнопка не работает, скопируйте адрес:<br/>{safe_link}</p>
    <p style="color:#707070;font-size:13px;margin-top:24px;">Если вы не запрашивали сброс — проигнорируйте письмо.<br/>Администратор системы</p>
  </div>
</body></html>"""


def is_smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASSWORD"))


def _smtp_from() -> tuple[str, str]:
    user = os.environ["SMTP_USER"]
    # Пустая строка из Docker env тоже считаем «не задано»
    from_email = (os.environ.get("SMTP_FROM_EMAIL") or user).strip()
    from_name = (os.environ.get("SMTP_FROM_NAME") or "Администратор системы AGB Tasks").strip()
    return from_email, from_name


def _send_smtp_sync(to_addr: str, subject: str, html_body: str, text_body: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASSWORD"]
    from_email, from_name = _smtp_from()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to_addr
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    raw = msg.as_string()
    use_ssl = os.environ.get("SMTP_SSL", "1").lower() not in ("0", "false", "no")

    if use_ssl or port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
            server.login(user, password)
            server.sendmail(from_email, [to_addr], raw)
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.starttls(context=ssl.create_default_context())
            server.login(user, password)
            server.sendmail(from_email, [to_addr], raw)


async def send_html_mail(to_addr: str, subject: str, html_body: str, text_body: str) -> tuple[bool, Optional[str]]:
    if not is_smtp_configured():
        logger.warning("SMTP не настроен (SMTP_HOST / SMTP_USER / SMTP_PASSWORD) — письмо на %s не отправлено", to_addr)
        return False, "mail_not_configured"
    broker = (os.environ.get("CELERY_BROKER_URL") or "").strip()
    if broker:
        from .tasks import send_html_mail_task

        async_result = send_html_mail_task.apply_async(args=[to_addr, subject, html_body, text_body])
        try:
            res = await asyncio.to_thread(async_result.get, 60)
        except Exception as e:
            logger.exception("Celery mail task failed for %s", to_addr)
            return False, str(e)
        if isinstance(res, dict) and res.get("ok"):
            return True, None
        err = (res or {}).get("err") if isinstance(res, dict) else "mail_failed"
        return False, str(err)
    try:
        await asyncio.to_thread(_send_smtp_sync, to_addr, subject, html_body, text_body)
        return True, None
    except Exception as e:
        logger.exception("Ошибка отправки почты на %s", to_addr)
        return False, str(e)


def build_registration_welcome(full_name: str, email: str, org_name: str) -> tuple[str, str, str]:
    subject = "Спасибо за регистрацию в AGB Tasks"
    display = (full_name or "").strip() or email
    safe_display = html_escape(display)
    safe_email = html_escape(email)
    safe_org = html_escape(org_name)
    text = (
        f"Здравствуйте, {display}!\n\n"
        f"Спасибо за регистрацию в AGB Tasks.\n"
        f"Организация: {org_name}\n"
        f"Аккаунт: {email}\n\n"
        f"С уважением,\nАдминистратор системы\n"
    )
    html_body = _REGISTRATION_WELCOME_HTML.format(
        safe_display=safe_display,
        safe_org=safe_org,
        safe_email=safe_email,
    )
    return subject, html_body, text


def build_login_otp_email(full_name: str, email: str, code: str) -> tuple[str, str, str]:
    subject = "Код для входа в AGB Tasks"
    display = (full_name or "").strip() or email
    safe_display = html_escape(display)
    safe_code = html_escape(code)
    text = (
        f"Здравствуйте, {display}!\n\n"
        f"Ваш одноразовый код для входа: {code}\n"
        f"Код действителен 15 минут.\n\n"
        f"Если вы не запрашивали вход, проигнорируйте это письмо.\n\n"
        f"Администратор системы\n"
    )
    html_body = _LOGIN_OTP_HTML.format(safe_display=safe_display, safe_code=safe_code)
    return subject, html_body, text


def build_password_reset_email(full_name: str, email: str, reset_link: str) -> tuple[str, str, str]:
    subject = "Сброс пароля — AGB Tasks"
    display = (full_name or "").strip() or email
    safe_display = html_escape(display)
    safe_link = html_escape(reset_link)
    text = (
        f"Здравствуйте, {display}!\n\n"
        f"Для сброса пароля AGB Tasks перейдите по ссылке (действительна 1 час):\n{reset_link}\n\n"
        f"Если вы не запрашивали сброс, проигнорируйте это письмо.\n\n"
        f"Администратор системы\n"
    )
    html_body = _PASSWORD_RESET_HTML.format(safe_display=safe_display, safe_link=safe_link)
    return subject, html_body, text
