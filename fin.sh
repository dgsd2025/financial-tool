#!/usr/bin/env bash
# 财务中心 · 本地服务管理
#   ./fin.sh start | stop | restart | status | logs | install | uninstall
#
# 已安装 LaunchAgent 时，start/stop 自动走 launchctl（开机自启 + 崩溃自愈）；
# 未安装时退化为普通后台进程，便于临时调试。
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="yc-finance-web"
PORT="${FIN_PORT:-5190}"
LABEL="com.xingyi.finance"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PID_FILE="$APP_DIR/.run/$APP_NAME.pid"
LOG_FILE="$APP_DIR/.run/$APP_NAME.log"
UID_NUM="$(id -u)"

mkdir -p "$APP_DIR/.run"

has_agent() { [ -f "$PLIST" ]; }
loaded()    { launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; }
health()    { curl -fsS -m 2 "http://localhost:$PORT/healthz" 2>/dev/null; }

wait_up() {
  for _ in $(seq 1 20); do
    health >/dev/null && return 0
    sleep 0.5
  done
  return 1
}

_pid() {
  [ -f "$PID_FILE" ] || return 1
  local p; p="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "${p:-}" ] && kill -0 "$p" 2>/dev/null && echo "$p"
}

start() {
  if health >/dev/null; then
    echo "已在运行 → http://localhost:$PORT"; return 0
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ 端口 $PORT 被其他程序占用。换端口： FIN_PORT=5191 ./fin.sh start"; return 1
  fi
  if has_agent; then
    launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null || launchctl kickstart -k "gui/$UID_NUM/$LABEL" 2>/dev/null
  else
    cd "$APP_DIR"
    nohup node server.js "$PORT" >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  fi
  if wait_up; then
    echo "✓ 财务中心已启动 → http://localhost:$PORT"
    has_agent && echo "  （由 launchd 托管：开机自启 + 崩溃自愈）"
  else
    echo "✗ 启动失败，看日志： ./fin.sh logs"; return 1
  fi
}

stop() {
  if has_agent && loaded; then
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
  fi
  if p="$(_pid)"; then
    kill "$p" 2>/dev/null; sleep 0.4
    kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
  fi
  rm -f "$PID_FILE"
  pkill -f "node server.js $PORT" 2>/dev/null
  sleep 0.5
  health >/dev/null && echo "✗ 仍在响应，请重试" || echo "✓ 已停止"
}

status() {
  echo "端口     : $PORT"
  echo "自启托管 : $(has_agent && (loaded && echo '已安装 · 已加载' || echo '已安装 · 未加载') || echo '未安装')"
  if health >/dev/null; then
    echo "服务状态 : 运行中"
    echo -n "健康检查 : "; health; echo
    has_agent && launchctl list 2>/dev/null | awk -v l="$LABEL" '$3==l{print "launchd  : pid "$1"  上次退出码 "$2}'
  else
    echo "服务状态 : 未运行"
    return 1
  fi
}

install_agent() {
  if ! has_agent; then
    echo "✗ 未找到 $PLIST"
    echo "  该文件由部署脚本生成，请确认是否被删除。"
    return 1
  fi
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
  launchctl bootstrap "gui/$UID_NUM" "$PLIST" && echo "✓ 已注册开机自启"
  wait_up && echo "✓ 服务已就绪 → http://localhost:$PORT"
}

uninstall_agent() {
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
  rm -f "$PLIST"
  echo "✓ 已移除开机自启（应用文件未删除）"
  echo "  如需彻底清理： rm -rf \"$APP_DIR/.run\""
}

case "${1:-status}" in
  start)     start ;;
  stop)      stop ;;
  restart)   stop; sleep 0.6; start ;;
  status)    status ;;
  logs)      tail -n 80 -f "$APP_DIR/.run/launchd.log" 2>/dev/null || tail -n 80 -f "$LOG_FILE" ;;
  install)   install_agent ;;
  uninstall) uninstall_agent ;;
  *) echo "用法: ./fin.sh start|stop|restart|status|logs|install|uninstall"; exit 1 ;;
esac
