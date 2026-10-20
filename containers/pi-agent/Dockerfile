# Exact base and verified Node/npm tarballs are recorded in runtime-lock.json.
ARG PYTHON_BASE
FROM ${PYTHON_BASE}
COPY --chmod=0755 .pi-build/node/bin/node /usr/local/bin/node
COPY --chmod=0755 .pi-build/uv /usr/local/bin/uv
COPY .pi-build/npm /opt/npm
WORKDIR /opt/pi
COPY containers/pi-agent/package.json containers/pi-agent/package-lock.json ./
RUN node /opt/npm/bin/npm-cli.js ci --registry=https://registry.npmmirror.com --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf /root/.npm && ln -s /opt/npm/bin/npm-cli.js /usr/local/bin/npm && chmod -R a-w /opt/npm
COPY containers/pi-agent/entrypoint.mjs containers/pi-agent/gateway-extension.mjs containers/pi-agent/native-capabilities.mjs containers/pi-agent/plan-analysis.py containers/pi-agent/file-transfer.py containers/pi-agent/terminal.py containers/pi-agent/workspace-files.py containers/pi-agent/dependency-install.py /opt/pi/
COPY backend/pi_runner/bundled_skills /opt/pi/skill-bundles
RUN node --check /opt/pi/entrypoint.mjs && node --check /opt/pi/gateway-extension.mjs && node --check /opt/pi/native-capabilities.mjs && node --input-type=module -e "await import('/opt/pi/native-capabilities.mjs')" && python3 -c "import ast,pathlib; ast.parse(pathlib.Path('/opt/pi/plan-analysis.py').read_text())"
RUN chmod -R a-w /opt/pi && mkdir -p /workspace && chown 65532:65532 /workspace
USER 65532:65532
WORKDIR /workspace
LABEL teruisi.pi.workspace="2"
LABEL teruisi.pi.native-capabilities="1"
ENTRYPOINT ["node", "/opt/pi/entrypoint.mjs"]
