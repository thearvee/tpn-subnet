# Use ubuntu server lts base
FROM ubuntu:24.04

# Install security updates
ENV DEBIAN_FRONTEND=noninteractive
RUN apt update && apt upgrade -y

# Install commands: ip, envsubst, nc
RUN apt update && apt install -y iproute2 gettext-base netcat-openbsd

# Install dante server
RUN apt update && apt install -y dante-server

# Copy our dante config file
COPY dante/danted.conf.template /etc/danted.conf.template

# Copy startup script
COPY dante/gen_users_and_start.sh /usr/local/bin/gen_users_and_start.sh
RUN chmod +x /usr/local/bin/gen_users_and_start.sh

# Document the dante server port
EXPOSE 1080

# Start the dante server
CMD ["/usr/local/bin/gen_users_and_start.sh"]

# Healthcheck call, expect the dante server to be up and listening on port 1080
HEALTHCHECK --interval=10s --timeout=5s --start-period=180s --retries=3 CMD nc -z localhost 1080 || exit 1
