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

# The base image already has a non-root `node` user (uid 1000), which is the
# usual uid on a laptop — so a mounted jobs directory is writable without
# arguments. Different uid? run with --user "$(id -u):$(id -g)".
WORKDIR /agent
COPY --chown=node:node . /agent
# WORKDIR creates /agent as root and `.dockerignore` keeps var/ out, so the
# directory the worker writes its models.json into has to be made on purpose.
RUN mkdir -p /agent/jobs /home/node/.pi/agent && chown -R node:node /agent /home/node/.pi

ENV NODE_ENV=production \
    VPL_JOBS=/jobs \
    VPL_PI_DIR=/home/node/.pi/agent

USER node
VOLUME ["/jobs"]
CMD ["node", "/agent/worker.mjs"]
