resolve_tts_cache_dir() {
  local repository_root="$1"
  local override="$2"
  local xdg_cache_home="$3"
  local home="$4"
  local cache_dir

  if [[ -n "$override" ]]; then
    cache_dir="$override"
  elif [[ -n "$xdg_cache_home" ]]; then
    cache_dir="$xdg_cache_home/tts2mic-mcp"
  else
    if [[ -z "$home" ]]; then
      echo "HOME or XDG_CACHE_HOME must be set to locate the TTS cache" >&2
      return 1
    fi
    cache_dir="$home/.cache/tts2mic-mcp"
  fi

  python3 - "$repository_root" "$cache_dir" <<'PY'
import os
import sys

repository_input, cache_input = sys.argv[1:]
if any("\n" in path or "\r" in path for path in (repository_input, cache_input)):
    print("TTS cache paths must not contain line breaks", file=sys.stderr)
    sys.exit(1)

repository_root = os.path.realpath(repository_input)
cache_dir = os.path.realpath(cache_input)
if any("\n" in path or "\r" in path for path in (repository_root, cache_dir)):
    print("TTS cache paths must not contain line breaks", file=sys.stderr)
    sys.exit(1)
try:
    inside_repository = os.path.commonpath((repository_root, cache_dir)) == repository_root
except ValueError:
    inside_repository = False
if inside_repository:
    print("TTS cache directory must be outside repository", file=sys.stderr)
    sys.exit(1)
print(cache_dir)
PY
}
