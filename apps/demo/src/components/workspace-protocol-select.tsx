export type WorkspaceProtocol = 'native' | 'agui';

export function WorkspaceProtocolSelect({
  value,
  onChange,
}: {
  value: WorkspaceProtocol;
  onChange: (value: WorkspaceProtocol) => void;
}) {
  return (
    <label className="workspace-protocol-select flex items-center gap-2 text-xs text-ink-2">
      <span className="hidden sm:inline">Workspace</span>
      <select
        aria-label="Workspace protocol"
        title="Changing protocol starts a new workspace session and disconnects voice."
        className="status-pill min-h-11 rounded-full bg-bg-1 px-3 text-ink"
        value={value}
        onChange={(event) => {
          if (event.target.value === 'native' || event.target.value === 'agui')
            onChange(event.target.value);
        }}
      >
        <option value="native">Maelstrom</option>
        <option value="agui">AG-UI</option>
      </select>
    </label>
  );
}
