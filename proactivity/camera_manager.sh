#!/bin/bash
# Camera Snapshot and Rotation Management Script with Integrity Validation and Alert State
# Location: /home/tomi/.openclaw/workspace/proactivity/camera_manager.sh

set -u

SNAPSHOT_DIR="/home/tomi/camera_snapshots"
STATE_DIR="/home/tomi/.openclaw/workspace/proactivity"
STATE_FILE="${STATE_DIR}/camera_alert_state.json"
MAX_SIZE_MB=200
MAX_SIZE_BYTES=$((MAX_SIZE_MB * 1024 * 1024))
FFMPEG_BIN="/home/tomi/tools/ffmpeg"
MIN_SIZE_KB=1  # Minimum acceptable JPEG size

# Ensure state directory exists
mkdir -p "$STATE_DIR"

# Load state if exists
declare -A last_status
declare -A consecutive_failures
declare -A last_alert_time

if [ -f "$STATE_FILE" ]; then
    # Parse JSON using jq if available, otherwise fallback to simple parsing
    if command -v jq &>/dev/null; then
        for cam in cam_112 cam_125 cam_133 cam_128; do
            last_status[$cam]=$(jq -r ".cameras[$cam].last_status // \"success\"" "$STATE_FILE")
            consecutive_failures[$cam]=$(jq -r ".cameras[$cam].consecutive_failures // 0" "$STATE_FILE")
            last_alert_time[$cam]=$(jq -r ".cameras[$cam].last_alert_time // null" "$STATE_FILE")
        done
    else
        # Minimal fallback: reset state if jq not present
        for cam in cam_112 cam_125 cam_133 cam_128; do
            last_status[$cam]="success"
            consecutive_failures[$cam]=0
            last_alert_time[$cam]=""
        done
    fi
else
    for cam in cam_112 cam_125 cam_133 cam_128; do
        last_status[$cam]="success"
        consecutive_failures[$cam]=0
        last_alert_time[$cam]=""
    done
fi

capture_snapshot() {
    local url="$1"
    local name="$2"
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local outfile="${name}_${timestamp}.jpg"
    local fullpath="${SNAPSHOT_DIR}/${outfile}"
    local retries=0
    local max_retries=3

    while [ $retries -lt $max_retries ]; do
        # Capture snapshot
        timeout 15 $FFMPEG_BIN -rtsp_transport tcp -i "$url" -frames:v 1 -f image2 -update 1 -y "$fullpath" 2>/dev/null

        # Validate file exists and meets minimum size
        if [ -f "$fullpath" ]; then
            local size
            size=$(stat -c%s "$fullpath" 2>/dev/null || echo 0)
            if [ "$size" -ge $((MIN_SIZE_KB * 1024)) ]; then
                echo "Captured: $outfile ($size bytes)"
                return 0
            else
                echo "Warning: $outfile too small ($size bytes), discarding." >&2
                rm -f "$fullpath"
            fi
        fi

        retries=$((retries + 1))
        if [ $retries -lt $max_retries ]; then
            sleep 1
        fi
    done

    echo "ERROR: Failed to capture $name (URL: $url) after $max_retries attempts" >&2
    return 1
}

# Define cameras: each entry is "URL|NAME" to preserve spaces
cameras=(
    "rtsp://rtsp:12345678@192.168.1.112:554/av_stream/ch0|cam_112"
    "rtsp://rtsp:UnG4YTZ6@192.168.1.133:554/av_stream/ch0|cam_133"
    "rtsp://rtsp:12345678@192.168.1.125:554/av_stream/ch0|cam_125"
    "rtsp://rtsp:Ooly25UE@192.168.1.128:554/av_stream/ch0|cam_128"
)

overall_status=0
declare -A current_status

for entry in "${cameras[@]}"; do
    IFS='|' read -r url name <<< "$entry"
    if capture_snapshot "$url" "$name"; then
        current_status[$name]="success"
    else
        current_status[$name]="failure"
        overall_status=1
    fi
done

# Rotation: delete oldest files when total size exceeds limit
check_and_rotate() {
    if ! current_size=$(du -sb "$SNAPSHOT_DIR" 2>/dev/null | awk '{print $1}'); then
        current_size=0
    fi
    while [ "$current_size" -gt "$MAX_SIZE_BYTES" ]; do
        oldest_file=$(ls -tr "$SNAPSHOT_DIR"/*.jpg 2>/dev/null | head -n1)
        [ -z "$oldest_file" ] && break
        rm "$oldest_file"
        current_size=$(du -sb "$SNAPSHOT_DIR" 2>/dev/null | awk '{print $1}')
    done
}
check_and_rotate

# Produce machine-readable status JSON for alerting logic (consumed by heartbeat)
cat > "${SNAPSHOT_DIR}/last_run_status.json" <<EOF
{
$(
  snapshot_cam_list=("${!current_status[@]}")
  for i in "${!snapshot_cam_list[@]}"; do
    cam="${snapshot_cam_list[$i]}"
    echo -n "  \"$cam\": \"${current_status[$cam]}\""
    [ $i -lt $((${#snapshot_cam_list[@]} - 1)) ] && echo "," || echo ""
  done
)
}
EOF

# Save cumulative state for alert throttling
if command -v jq &>/dev/null; then
    # Build JSON state
    state_json="{"
    first=1
    snapshot_cam_list=("${!current_status[@]}")
    for cam in "${snapshot_cam_list[@]}"; do
        [ $first -eq 0 ] && state_json+=','
        state_json+=$(printf '"\n    %s": {\n      "last_status": "%s",\n      "consecutive_failures": %d,\n      "last_alert_time": %s\n    }' "$cam" "${last_status[$cam]}" "${consecutive_failures[$cam]}" "$(printf '%q' "${last_alert_time[$cam]}")")
        first=0
    done
    state_json+="\n}\n"
    echo "$state_json" | jq '.' > "$STATE_FILE"
else
    # Without jq, write a minimal echo (state not persisted reliably)
    :
fi

exit $overall_status