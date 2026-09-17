#!/usr/bin/env bash
# Blocks outgoing traffic to private/local networks (the user's LAN, the Docker host, cloud
# metadata endpoints) while keeping internet access. Runs as root before privileges are dropped,
# so the agent cannot change these rules afterwards.
set -euo pipefail

if [ "${BOTLINGS_ALLOW_LAN:-0}" = "1" ]; then
  echo "[firewall] LAN access allowed (BOTLINGS_ALLOW_LAN=1)"
  exit 0
fi

# Prefer the nftables backend; fall back to legacy iptables if the kernel lacks nf_tables.
IPT=iptables
IP6T=ip6tables
if ! iptables -L OUTPUT -n >/dev/null 2>&1; then
  IPT=iptables-legacy
  IP6T=ip6tables-legacy
fi

PRIVATE_V4="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 127.0.0.0/8 0.0.0.0/8 224.0.0.0/4 240.0.0.0/4"

$IPT -F OUTPUT
$IPT -A OUTPUT -o lo -j ACCEPT
# Replies to connections opened from outside (the Botlings server reaching the runner/noVNC).
$IPT -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# DNS resolvers configured by Docker usually live on a private address.
for ns in $(awk '/^nameserver/ { print $2 }' /etc/resolv.conf | grep -v ':' || true); do
  $IPT -A OUTPUT -d "$ns" -p udp --dport 53 -j ACCEPT
  $IPT -A OUTPUT -d "$ns" -p tcp --dport 53 -j ACCEPT
done
for net in $PRIVATE_V4; do
  $IPT -A OUTPUT -d "$net" -j REJECT
done

# IPv6 is often disabled in the container; apply rules only when available.
if $IP6T -L OUTPUT -n >/dev/null 2>&1; then
  $IP6T -F OUTPUT
  $IP6T -A OUTPUT -o lo -j ACCEPT
  $IP6T -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  for net in ::1/128 fc00::/7 fe80::/10 ff00::/8 ::ffff:0:0/96; do
    $IP6T -A OUTPUT -d "$net" -j REJECT
  done
fi

echo "[firewall] private networks blocked"
