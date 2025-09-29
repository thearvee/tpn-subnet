# Use linuxserver wireguard image base
FROM lscr.io/linuxserver/wireguard:latest

# Overwrite the /etc/s6-overlay/s6-rc.d/init-wireguard-confs/run file with our local ./tpn_wireguard.init.sh file
COPY tpn_wireguard.init.sh /etc/s6-overlay/s6-rc.d/init-wireguard-confs/run
RUN chmod +x /etc/s6-overlay/s6-rc.d/init-wireguard-confs/run

# Add a healthcheck
HEALTHCHECK --interval=2s --timeout=2s --start-period=120s --retries=5 CMD ip link show wg0
