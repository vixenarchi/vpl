# va-agent: a person's own agent, in a box.
#
# Outbound only. It reads a jobs directory and writes reports; it opens no port
# and needs no inbound connection, which is why a free tier box is enough.
#
#   docker build -t va-agent .
#   docker run --rm -v "$PWD/jobs:/jobs" --env-file agent.env va-agent

FROM node:26-slim

ARG TERRAFORM_VERSION=1.17.2

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep jq unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSLo /tmp/tf.zip "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" \
 && unzip -o /tmp/tf.zip -d /usr/local/bin >/dev/null \
 && rm -f /tmp/tf.zip \
 && terraform version \
 && npm i -g @earendil-works/pi-coding-agent \
 && npm cache clean --force

RUN useradd -m -s /bin/bash agent
WORKDIR /agent
COPY --chown=agent:agent . /agent

ENV NODE_ENV=production \
    VPL_JOBS=/jobs \
    VPL_PI_DIR=/agent/var/pi

USER agent
VOLUME ["/jobs"]
CMD ["node", "/agent/worker.mjs"]
