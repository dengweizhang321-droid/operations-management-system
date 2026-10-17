# Exact base and verified Node/npm tarballs are recorded in runtime-lock.json.
ARG PYTHON_BASE
FROM ${PYTHON_BASE}
COPY --chmod=0755 .pi-build/node/bin/node /usr/local/bin/node
COPY .pi-build/npm /opt/npm
WORKDIR /opt/pi
COPY containers/pi-agent/package.json containers/pi-agent/package-lock.json ./
RUN node /opt/npm/bin/npm-cli.js ci --registry=https://registry.npmmirror.com --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf /opt/npm /root/.npm
COPY containers/pi-agent/entrypoint.mjs containers/pi-agent/gateway-extension.mjs containers/pi-agent/file-transfer.py /opt/pi/
COPY backend/pi_runner/bundled_skills /opt/pi/skill-bundles
RUN chmod -R a-w /opt/pi && mkdir -p /workspace && chown 65532:65532 /workspace
USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/pi/entrypoint.mjs"]
