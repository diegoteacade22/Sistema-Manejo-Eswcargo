#!/bin/zsh
set -u

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPOSITORY="diegoteacade22/Sistema-Manejo-Eswcargo"
ISSUE_NUMBER="45"
TASK_LABEL="diegoserver-task"
STATE_DIR="$HOME/.diegoserver-worker"
ISOLATED_REPO="$STATE_DIR/repo"
RUNTIME_WORKER="$STATE_DIR/worker.mjs"
LAUNCH_LABEL="com.esw.diegoserver-worker"
BOOTSTRAP_TMP="$(mktemp -d -t diegoserver-bootstrap.XXXXXX)" || exit 10

cleanup() {
  [[ -n "${BOOTSTRAP_TMP:-}" && -d "$BOOTSTRAP_TMP" && "${BOOTSTRAP_TMP:t}" == diegoserver-bootstrap.* ]] && rm -rf -- "$BOOTSTRAP_TMP"
}
trap cleanup EXIT INT TERM

fail() {
  echo "BOOTSTRAP_ERROR: $1" >&2
  exit "${2:-1}"
}

retry() {
  local attempts="$1"
  shift
  local n=1
  until "$@"; do
    (( n >= attempts )) && return 1
    echo "Reintento $n/$attempts: $*" >&2
    sleep $((n * 2))
    (( n++ ))
  done
}

clone_source() {
  if [[ -e "$BOOTSTRAP_TMP/source" ]]; then
    [[ "${BOOTSTRAP_TMP:t}" == diegoserver-bootstrap.* ]] || return 1
    rm -rf -- "$BOOTSTRAP_TMP/source"
  fi
  gh repo clone "$REPOSITORY" "$BOOTSTRAP_TMP/source" -- --depth 1 --branch main
}

echo "1/6 Verificando herramientas"
for tool in gh git node codex zsh launchctl; do
  command -v "$tool" >/dev/null 2>&1 || fail "Falta $tool en DiegoServer" 20
done
gh auth status >/dev/null 2>&1 || fail "GitHub CLI no está autenticado" 21

echo "2/6 Descargando una fuente limpia y temporal"
retry 3 clone_source || fail "No se pudo clonar main después de 3 intentos" 30
[[ -d "$BOOTSTRAP_TMP/source/.git" ]] || fail "La fuente temporal no es un repositorio Git" 31
[[ -f "$BOOTSTRAP_TMP/source/company-os/diegoserver-worker/install.sh" ]] || fail "Falta install.sh en main" 32
[[ -f "$BOOTSTRAP_TMP/source/company-os/diegoserver-worker/worker.mjs" ]] || fail "Falta worker.mjs en main" 33
node --check "$BOOTSTRAP_TMP/source/company-os/diegoserver-worker/worker.mjs" || fail "worker.mjs no pasa validación sintáctica" 34
zsh -n "$BOOTSTRAP_TMP/source/company-os/diegoserver-worker/install.sh" || fail "install.sh no pasa validación sintáctica" 35

echo "3/6 Instalando worker aislado"
DIEGOSERVER_SOURCE_REPO="$BOOTSTRAP_TMP/source" zsh "$BOOTSTRAP_TMP/source/company-os/diegoserver-worker/install.sh" || fail "Falló el instalador aislado" 40

echo "4/6 Verificando aislamiento y launchd"
[[ -f "$RUNTIME_WORKER" ]] || fail "No existe el runtime aislado" 41
[[ -d "$ISOLATED_REPO/.git" ]] || fail "No existe el clon aislado" 42
case "${ISOLATED_REPO:A}" in
  "${STATE_DIR:A}"/*) ;;
  *) fail "El repositorio del worker quedó fuera del directorio aislado" 43 ;;
esac
launchctl print "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1 || fail "launchd no reporta el worker" 44
sleep 3
pgrep -f "$RUNTIME_WORKER" >/dev/null 2>&1 || {
  launchctl kickstart -k "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1 || true
  sleep 3
  pgrep -f "$RUNTIME_WORKER" >/dev/null 2>&1 || fail "El proceso del worker no quedó activo" 45
}

echo "5/6 Preparando y disparando la misión #$ISSUE_NUMBER"
gh issue view "$ISSUE_NUMBER" --repo "$REPOSITORY" >/dev/null 2>&1 || fail "No existe o no es accesible el issue #$ISSUE_NUMBER" 50
gh label create "$TASK_LABEL" --repo "$REPOSITORY" --description "Tarea para DiegoServer Codex worker" --color "1D76DB" --force >/dev/null 2>&1 || fail "No se pudo asegurar la etiqueta $TASK_LABEL" 51
retry 3 gh issue edit "$ISSUE_NUMBER" --repo "$REPOSITORY" --add-label "$TASK_LABEL" >/dev/null || fail "No se pudo etiquetar el issue #$ISSUE_NUMBER" 52

echo "6/6 Readback final"
issue_labels="$(gh issue view "$ISSUE_NUMBER" --repo "$REPOSITORY" --json labels --jq '.labels[].name' 2>/dev/null)"
print -r -- "$issue_labels" | grep -Fx "$TASK_LABEL" >/dev/null || fail "La etiqueta no aparece en el readback" 53
launchctl print "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1 || fail "El worker dejó de responder después del dispatch" 54

echo "DIEGOSERVER_BOOTSTRAP_OK"
echo "WORKER_REPO=$ISOLATED_REPO"
echo "MISSION_ISSUE=https://github.com/$REPOSITORY/issues/$ISSUE_NUMBER"
echo "La misión quedó encolada. El worker la tomará en un máximo de 60 segundos."
