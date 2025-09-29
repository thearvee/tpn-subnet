#!/usr/bin/with-contenv bash
# shellcheck shell=bash
# shellcheck disable=SC2016,SC1091,SC2183

mkdir -p /config/wg_confs

# migration to subfolder for wg confs
if [[ -z "$(ls -A /config/wg_confs)" ]] && [[ -f /config/wg0.conf ]]; then
    echo "**** Performing migration to new folder structure for confs. Please see the image changelog 2023-10-03 entry for more details. ****"
    cp /config/wg0.conf /config/wg_confs/wg0.conf
    rm -rf /config/wg0.conf || :
fi

# prepare templates
if [[ ! -f /config/templates/server.conf ]]; then
    cp /defaults/server.conf /config/templates/server.conf
fi
if [[ ! -f /config/templates/peer.conf ]]; then
    cp /defaults/peer.conf /config/templates/peer.conf
fi
# add preshared key to user templates (backwards compatibility)
if ! grep -q 'PresharedKey' /config/templates/peer.conf; then
    sed -i 's|^Endpoint|PresharedKey = \$\(cat /config/\${PEER_ID}/presharedkey-\${PEER_ID}\)\nEndpoint|' /config/templates/peer.conf
fi

generate_confs () {

    # Create server keys if not present
    mkdir -p /config/server
    if [[ ! -f /config/server/privatekey-server ]]; then
        umask 077
        wg genkey | tee /config/server/privatekey-server | wg pubkey > /config/server/publickey-server
    fi

    # Temporary workspace to avoid races between parallel jobs
    TMPWG="/config/wg_confs/.tmp"
    rm -rf "${TMPWG}" 2>/dev/null || true
    mkdir -p "${TMPWG}" "${TMPWG}/peer_fragments" "${TMPWG}/ip_map"

    # Write server header to temp file (final assembly happens later)
    eval "$(printf %s)
    cat <<DUDE > ${TMPWG}/wg0.header.conf
$(cat /config/templates/server.conf)

DUDE"

    # Precompute unique IPs serially to avoid duplicate allocation under parallel load
    for i in "${PEERS_ARRAY[@]}"; do
        if [[ ! "${i}" =~ ^[[:alnum:]]+$ ]]; then
            echo "**** Peer ${i} contains non-alphanumeric characters and thus will be skipped. No config for peer ${i} will be generated. ****"
            continue
        fi
        if [[ "${i}" =~ ^[0-9]+$ ]]; then
            PEER_ID="peer${i}"
        else
            PEER_ID="peer_${i}"
        fi

        CLIENT_IP=""
        if [[ -f "/config/${PEER_ID}/${PEER_ID}.conf" ]]; then
            CLIENT_IP=$(grep "Address" "/config/${PEER_ID}/${PEER_ID}.conf" | awk '{print $NF}')
            if [[ -n "${ORIG_INTERFACE}" ]] && [[ "${INTERFACE}" != "${ORIG_INTERFACE}" ]]; then
                CLIENT_IP="${CLIENT_IP//${ORIG_INTERFACE}/${INTERFACE}}"
            fi
        else
            for idx in {2..254}; do
                PROPOSED_IP="${INTERFACE}.${idx}"
                if ! grep -q -R "${PROPOSED_IP}" /config/peer*/*.conf 2>/dev/null \
                   && ([[ -z "${ORIG_INTERFACE}" ]] || ! grep -q -R "${ORIG_INTERFACE}.${idx}" /config/peer*/*.conf 2>/dev/null) \
                   && [[ ! -f "${TMPWG}/ip_map/${PROPOSED_IP}" ]]; then
                    CLIENT_IP="${PROPOSED_IP}"
                    : > "${TMPWG}/ip_map/${PROPOSED_IP}"
                    break
                fi
            done
        fi

        if [[ -z "${CLIENT_IP}" ]]; then
            echo "**** Could not determine IP for ${PEER_ID}; skipping. ****"
            continue
        fi
        printf '%s' "${CLIENT_IP}" > "${TMPWG}/ip_map/${PEER_ID}.ip"
    done

    # Parallelize per-peer generation, but avoid writing to wg0.conf directly
    local num_procs
    num_procs=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
    num_procs=$((num_procs * 5))
    for i in "${PEERS_ARRAY[@]}"; do
        # process only peers with an assigned IP
        if [[ -f "${TMPWG}/ip_map/peer_${i}.ip" || -f "${TMPWG}/ip_map/peer${i}.ip" ]]; then
            generate_single_conf "${i}" &
            if (( $(jobs -r -p | wc -l) >= num_procs )); then
                wait -n
            fi
        fi
    done
    wait

    # Assemble final wg0.conf atomically: header + all peer fragments
    {
        cat "${TMPWG}/wg0.header.conf";
        for frag in $(ls -1 "${TMPWG}/peer_fragments"/*.server.conf 2>/dev/null | LC_ALL=C sort); do
            cat "$frag"
        done
    } > "${TMPWG}/wg0.conf"
    mv -f "${TMPWG}/wg0.conf" /config/wg_confs/wg0.conf
    rm -rf "${TMPWG}" 2>/dev/null || true
}

generate_single_conf() {

    local i="$1"

    if [[ ! "${i}" =~ ^[[:alnum:]]+$ ]]; then
            echo "**** Peer ${i} contains non-alphanumeric characters and thus will be skipped. No config for peer ${i} will be generated. ****"
        else
            if [[ "${i}" =~ ^[0-9]+$ ]]; then
                PEER_ID="peer${i}"
            else
                PEER_ID="peer_${i}"
            fi

            # Create peer folder
            mkdir -p "/config/${PEER_ID}"

            # Create peer keys if they do not exist
            if [[ ! -f "/config/${PEER_ID}/privatekey-${PEER_ID}" ]]; then
                umask 077
                wg genkey | tee "/config/${PEER_ID}/privatekey-${PEER_ID}" | wg pubkey > "/config/${PEER_ID}/publickey-${PEER_ID}"
                wg genpsk > "/config/${PEER_ID}/presharedkey-${PEER_ID}"
            fi

            # Use precomputed IP to avoid races with other jobs
            local CLIENT_IP=""
            if [[ -f "/config/wg_confs/.tmp/ip_map/${PEER_ID}.ip" ]]; then
                CLIENT_IP=$(cat "/config/wg_confs/.tmp/ip_map/${PEER_ID}.ip")
            fi
            if [[ -z "${CLIENT_IP}" ]]; then
                echo "**** Skipping ${PEER_ID}; no precomputed IP found ****"
                return 0
            fi

            # Create peer conf file and add peer to server conf
            if [[ -f "/config/${PEER_ID}/presharedkey-${PEER_ID}" ]]; then
                # create peer conf with presharedkey
                eval "$(printf %s)
                cat <<DUDE > /config/${PEER_ID}/${PEER_ID}.conf
$(cat /config/templates/peer.conf)
DUDE"
                # write peer fragment with presharedkey
                mkdir -p /config/wg_confs/.tmp/peer_fragments
                cat <<DUDE > /config/wg_confs/.tmp/peer_fragments/${PEER_ID}.server.conf
[Peer]
# ${PEER_ID}
PublicKey = $(cat "/config/${PEER_ID}/publickey-${PEER_ID}")
PresharedKey = $(cat "/config/${PEER_ID}/presharedkey-${PEER_ID}")
DUDE
            else
                echo "**** Existing keys with no preshared key found for ${PEER_ID}, creating confs without preshared key for backwards compatibility ****"
                # create peer conf without presharedkey
                eval "$(printf %s)
                cat <<DUDE > /config/${PEER_ID}/${PEER_ID}.conf
$(sed '/PresharedKey/d' "/config/templates/peer.conf")
DUDE"
                # write peer fragment without presharedkey
                mkdir -p /config/wg_confs/.tmp/peer_fragments
                cat <<DUDE > /config/wg_confs/.tmp/peer_fragments/${PEER_ID}.server.conf
[Peer]
# ${PEER_ID}
PublicKey = $(cat "/config/${PEER_ID}/publickey-${PEER_ID}")
DUDE
            fi
            SERVER_ALLOWEDIPS=SERVER_ALLOWEDIPS_PEER_${i}
            # add peer's allowedips to server fragment
            if [[ -n "${!SERVER_ALLOWEDIPS}" ]]; then
                echo "Adding ${!SERVER_ALLOWEDIPS} to wg0.conf's AllowedIPs for peer ${i}"
                cat <<DUDE >> /config/wg_confs/.tmp/peer_fragments/${PEER_ID}.server.conf
AllowedIPs = ${CLIENT_IP}/32,${!SERVER_ALLOWEDIPS}
DUDE
            else
                cat <<DUDE >> /config/wg_confs/.tmp/peer_fragments/${PEER_ID}.server.conf
AllowedIPs = ${CLIENT_IP}/32
DUDE
            fi
            # add PersistentKeepalive if the peer is specified
            if [[ -n "${PERSISTENTKEEPALIVE_PEERS_ARRAY}" ]] && ([[ "${PERSISTENTKEEPALIVE_PEERS_ARRAY[0]}" = "all" ]] || printf '%s\0' "${PERSISTENTKEEPALIVE_PEERS_ARRAY[@]}" | grep -Fxqz -- "${i}"); then
                cat <<DUDE >> /config/wg_confs/.tmp/peer_fragments/${PEER_ID}.server.conf
PersistentKeepalive = 25

DUDE
            else
                cat <<DUDE >> /config/wg_confs/.tmp/peer_fragments/${PEER_ID}.server.conf

DUDE
            fi

            # Log the conf file and QR code
            if [[ -z "${LOG_CONFS}" ]] || [[ "${LOG_CONFS}" = "true" ]]; then
                echo "PEER ${i} QR code (conf file is saved under /config/${PEER_ID}):"
                qrencode -t ansiutf8 < "/config/${PEER_ID}/${PEER_ID}.conf"
            else
                echo "PEER ${i} conf and QR code png saved in /config/${PEER_ID}"
            fi
            # qrencode -o "/config/${PEER_ID}/${PEER_ID}.png" < "/config/${PEER_ID}/${PEER_ID}.conf"
        fi
}

save_vars () {
    cat <<DUDE > /config/.donoteditthisfile
ORIG_SERVERURL="$SERVERURL"
ORIG_SERVERPORT="$SERVERPORT"
ORIG_PEERDNS="$PEERDNS"
ORIG_PEERS="$PEERS"
ORIG_INTERFACE="$INTERFACE"
ORIG_ALLOWEDIPS="$ALLOWEDIPS"
ORIG_PERSISTENTKEEPALIVE_PEERS="$PERSISTENTKEEPALIVE_PEERS"
DUDE
}

if [[ -n "$PEERS" ]]; then
    echo "**** Server mode is selected ****"
    if [[ "$PEERS" =~ ^[0-9]+$ ]] && ! [[ "$PEERS" = *,* ]]; then
        mapfile -t PEERS_ARRAY < <(seq 1 "${PEERS}")
    else
        mapfile -t PEERS_ARRAY < <(echo "${PEERS}" | tr ',' '\n')
    fi
    if [[ -n "${PERSISTENTKEEPALIVE_PEERS}" ]]; then
        echo "**** PersistentKeepalive will be set for: ${PERSISTENTKEEPALIVE_PEERS/,/ } ****"
        mapfile -t PERSISTENTKEEPALIVE_PEERS_ARRAY < <(echo "${PERSISTENTKEEPALIVE_PEERS}" | tr ',' '\n')
    fi
    if [[ -z "$SERVERURL" ]] || [[ "$SERVERURL" = "auto" ]]; then
        SERVERURL=$(curl -s icanhazip.com)
        echo "**** SERVERURL var is either not set or is set to \"auto\", setting external IP to auto detected value of $SERVERURL ****"
    else
        echo "**** External server address is set to $SERVERURL ****"
    fi
    SERVERPORT=${SERVERPORT:-51820}
    echo "**** External server port is set to ${SERVERPORT}. Make sure that port is properly forwarded to port 51820 inside this container ****"
    INTERNAL_SUBNET=${INTERNAL_SUBNET:-10.13.13.0}
    echo "**** Internal subnet is set to $INTERNAL_SUBNET ****"
    INTERFACE=$(echo "$INTERNAL_SUBNET" | awk 'BEGIN{FS=OFS="."} NF--')
    ALLOWEDIPS=${ALLOWEDIPS:-0.0.0.0/0, ::/0}
    echo "**** AllowedIPs for peers $ALLOWEDIPS ****"
    if [[ -z "$PEERDNS" ]] || [[ "$PEERDNS" = "auto" ]]; then
        PEERDNS="${INTERFACE}.1"
        echo "**** PEERDNS var is either not set or is set to \"auto\", setting peer DNS to ${INTERFACE}.1 to use wireguard docker host's DNS. ****"
    else
        echo "**** Peer DNS servers will be set to $PEERDNS ****"
    fi
    if [[ ! -f /config/wg_confs/wg0.conf ]]; then
        echo "**** No wg0.conf found (maybe an initial install), generating 1 server and ${PEERS} peer/client confs ****"
        generate_confs
        save_vars
    else
        echo "**** Server mode is selected ****"
        if [[ -f /config/.donoteditthisfile ]]; then
            . /config/.donoteditthisfile
        fi
        if [[ "$SERVERURL" != "$ORIG_SERVERURL" ]] || [[ "$SERVERPORT" != "$ORIG_SERVERPORT" ]] || [[ "$PEERDNS" != "$ORIG_PEERDNS" ]] || [[ "$PEERS" != "$ORIG_PEERS" ]] || [[ "$INTERFACE" != "$ORIG_INTERFACE" ]] || [[ "$ALLOWEDIPS" != "$ORIG_ALLOWEDIPS" ]] || [[ "$PERSISTENTKEEPALIVE_PEERS" != "$ORIG_PERSISTENTKEEPALIVE_PEERS" ]]; then
            echo "**** Server related environment variables changed, regenerating 1 server and ${PEERS} peer/client confs ****"
            generate_confs
            save_vars
        else
            echo "**** No changes to parameters. Existing configs are used. ****"
        fi
    fi
else
    echo "**** Client mode selected. ****"
    USE_COREDNS="${USE_COREDNS,,}"
    printf %s "${USE_COREDNS:-false}" > /run/s6/container_environment/USE_COREDNS
fi

# set up CoreDNS
if [[ ! -f /config/coredns/Corefile ]]; then
    cp /defaults/Corefile /config/coredns/Corefile
fi

# permissions
lsiown -R abc:abc \
    /config


# Always run generate confs on first-run to regenerate missing confs
echo "**** Running generate_confs to regenerate any missing confs ****"
generate_confs
echo "**** generate_confs complete ****"

# Run a background job with REGEN_MISSING_CONFIGS_INTERVAL, it triggers generate_confs if it is not running already
while true; do

    # Check if generate confs is already running
    if pgrep "generate_confs" >/dev/null 2>&1; then
        echo "**** generate_confs is still running, sleeping for ${REGEN_MISSING_CONFIGS_INTERVAL:-300} seconds until next check ****"
        sleep "${REGEN_MISSING_CONFIGS_INTERVAL:-300}"
        continue
    fi

    # Always run generate confs on first-run to regenerate missing confs
    echo "**** Running generate_confs to regenerate any missing confs ****"
    generate_confs
    echo "**** generate_confs complete ****"

    # wait for regen
    echo "**** Sleeping for ${REGEN_MISSING_CONFIGS_INTERVAL:-300} seconds until next check for missing configs ****"
    sleep "${REGEN_MISSING_CONFIGS_INTERVAL:-300}"
    

done &