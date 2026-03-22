#!/bin/sh
# Добавьте в /etc/letsencrypt/renewal/agbtasker.ru.conf в [renewalparams]:
#   deploy_hook = /opt/kaiten_copy/deploy/certbot/deploy-hook-reload-nginx.sh
# Либо один раз: certbot renew --deploy-hook "/opt/kaiten_copy/deploy/certbot/deploy-hook-reload-nginx.sh"
set -eu
docker exec kaiten_copy-nginx-1 nginx -s reload
