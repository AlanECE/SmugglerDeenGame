#!/usr/bin/env bash
# =============================================================
#  Déploiement tout-en-un de "Douane & Contrebande"
#  À lancer EN ROOT sur le serveur (Ubuntu/Debian).
#
#  Exemple :
#    DUCKDNS_SUBDOMAIN=moncontre DUCKDNS_TOKEN=xxxx-xxxx \
#    EMAIL=alan.lateb@gmail.com bash setup.sh
#
#  - DUCKDNS_SUBDOMAIN : la partie avant .duckdns.org (ex: "moncontre")
#  - DUCKDNS_TOKEN     : ton token DuckDNS (https://www.duckdns.org)
#  - EMAIL             : email pour le certificat HTTPS (optionnel)
#
#  Sans DuckDNS, le jeu reste accessible via http://IP_DU_SERVEUR
# =============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/alanece/smugglerdeengame.git}"
BRANCH="${BRANCH:-claude/smuggling-party-game-6jsj9x}"
APP_DIR="/opt/smuggler"
PORT="${PORT:-3000}"

echo "==> Mise à jour des paquets"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ca-certificates

echo "==> Installation de Node.js 20 (si absent)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Récupération du code dans $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "==> Installation des dépendances"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

echo "==> Service systemd"
cat > /etc/systemd/system/smuggler.service <<EOF
[Unit]
Description=Douane & Contrebande - jeu multijoueur
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=$PORT
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable smuggler
systemctl restart smuggler
echo "==> Service lancé."

# -------- DuckDNS (domaine dynamique gratuit) --------
DOMAIN=""
if [ -n "${DUCKDNS_SUBDOMAIN:-}" ] && [ -n "${DUCKDNS_TOKEN:-}" ]; then
  DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"
  echo "==> Configuration DuckDNS pour $DOMAIN"
  mkdir -p /opt/duckdns
  cat > /opt/duckdns/duck.sh <<EOF
#!/bin/bash
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" -o /opt/duckdns/duck.log
EOF
  chmod +x /opt/duckdns/duck.sh
  /opt/duckdns/duck.sh || true
  # rafraîchit l'IP toutes les 5 min
  (crontab -l 2>/dev/null | grep -v 'duckdns/duck.sh'; echo "*/5 * * * * /opt/duckdns/duck.sh >/dev/null 2>&1") | crontab -
  echo "    DuckDNS mis à jour (réponse: $(cat /opt/duckdns/duck.log 2>/dev/null))"
fi

# -------- Nginx reverse proxy (avec support WebSocket) --------
# Libère le port 80 si Apache l'occupe
if systemctl is-active --quiet apache2 2>/dev/null; then
  echo "==> Désactivation d'Apache (occupe le port 80)"
  systemctl disable --now apache2 || true
fi

SERVER_NAME="${DOMAIN:-_}"
echo "==> Configuration de Nginx (server_name: $SERVER_NAME)"
cat > /etc/nginx/sites-available/smuggler <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/smuggler /etc/nginx/sites-enabled/smuggler
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Ouvre le pare-feu si ufw est actif
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

# -------- HTTPS via Let's Encrypt (recommandé : clipboard + sécurité mobile) --------
if [ -n "$DOMAIN" ]; then
  echo "==> Installation du certificat HTTPS pour $DOMAIN"
  apt-get install -y certbot python3-certbot-nginx
  EMAIL_ARG="--register-unsafely-without-email"
  [ -n "${EMAIL:-}" ] && EMAIL_ARG="--email ${EMAIL}"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect $EMAIL_ARG || \
    echo "!! Certbot a échoué (le DNS DuckDNS doit pointer vers ce serveur). Le jeu reste accessible en HTTP."
fi

echo ""
echo "============================================================"
echo " ✅ Déploiement terminé."
if [ -n "$DOMAIN" ]; then
  echo "   Joue ici  : https://$DOMAIN"
else
  IP=$(curl -fsS https://api.ipify.org 2>/dev/null || echo "IP_DU_SERVEUR")
  echo "   Joue ici  : http://$IP"
fi
echo "   Logs      : journalctl -u smuggler -f"
echo "   Redéploie : systemctl restart smuggler"
echo "============================================================"
