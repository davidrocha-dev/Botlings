# Botlings agent computer: a small Linux desktop with Chromium, a terminal and a control API.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    SCREEN_GEOMETRY=1280x800x24 \
    LANG=C.UTF-8 \
    TZ=Europe/Lisbon

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb fluxbox x11vnc x11-xserver-utils novnc websockify \
      chromium fonts-noto fonts-noto-color-emoji \
      ca-certificates curl git jq less nano procps python3 python3-pip python-is-python3 unzip wget xterm \
    && rm -rf /var/lib/apt/lists/* \
    # Black letterboxing around the scaled screen instead of noVNC's grey.
    && echo 'body, #noVNC_container { background: #000 !important; border-radius: 0 !important; }' >> /usr/share/novnc/app/styles/base.css \
    && sed -i "s/const DEFAULT_BACKGROUND = 'rgb(40, 40, 40)'/const DEFAULT_BACKGROUND = '#000'/" /usr/share/novnc/core/rfb.js \
    && grep -q "DEFAULT_BACKGROUND = '#000'" /usr/share/novnc/core/rfb.js

# Unprivileged user that owns everything the agent can touch.
RUN userdel -r node 2>/dev/null || true \
    && useradd --create-home --uid 1000 --shell /bin/bash botling \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

WORKDIR /opt/runner
COPY runner/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY runner/ ./
RUN chmod +x /opt/runner/desktop/open-browser.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER botling
WORKDIR /home/botling
EXPOSE 8080 6080

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD curl -fsS http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
