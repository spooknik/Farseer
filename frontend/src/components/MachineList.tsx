import { useState, useEffect, useMemo } from 'react';
import { listMachines, deleteMachine, listGroups, createGroup, deleteGroup } from '../services/api';
import type { Machine, Group } from '../types';

interface MachineListProps {
  selectedMachine: Machine | null;
  onSelectMachine: (machine: Machine | null) => void;
  onAddMachine: () => void;
  onEditMachine: (machine: Machine) => void;
  openSessions?: Machine[];
  sessionStatuses?: Record<number, 'connecting' | 'connected' | 'disconnected' | 'error'>;
}

export default function MachineList({
  selectedMachine,
  onSelectMachine,
  onAddMachine,
  onEditMachine,
  openSessions = [],
  sessionStatuses = {},
}: MachineListProps) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const groupedMachines = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = searchQuery.trim()
      ? machines.filter(
          (machine) =>
            machine.name.toLowerCase().includes(query) ||
            machine.hostname.toLowerCase().includes(query) ||
            machine.username.toLowerCase().includes(query)
        )
      : machines;

    const grouped: { [key: string]: Machine[] } = { ungrouped: [] };
    groups.forEach((g) => {
      grouped[g.id] = [];
    });

    filtered.forEach((machine) => {
      if (machine.group_id && grouped[machine.group_id]) {
        grouped[machine.group_id].push(machine);
      } else {
        grouped.ungrouped.push(machine);
      }
    });

    return grouped;
  }, [machines, groups, searchQuery]);

  const fetchData = async () => {
    try {
      const [machinesData, groupsData] = await Promise.all([
        listMachines(),
        listGroups(),
      ]);
      setMachines(machinesData);
      setGroups(groupsData);
      setError('');
    } catch {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = async (e: React.MouseEvent, machine: Machine) => {
    e.stopPropagation();
    if (!confirm(`Delete "${machine.name}"?`)) return;

    try {
      await deleteMachine(machine.id);
      if (selectedMachine?.id === machine.id) {
        onSelectMachine(null);
      }
      fetchData();
    } catch {
      alert('Failed to delete machine');
    }
  };

  const handleDeleteGroup = async (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    if (!confirm(`Delete group "${group.name}"? Machines will be ungrouped.`)) return;

    try {
      await deleteGroup(group.id);
      fetchData();
    } catch {
      alert('Failed to delete group');
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await createGroup({ name: newGroupName.trim() });
      setNewGroupName('');
      setShowNewGroupInput(false);
      fetchData();
    } catch {
      alert('Failed to create group');
    }
  };

  const toggleGroup = (groupId: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const isSessionOpen = (machineId: number) => {
    return openSessions.some((m) => m.id === machineId);
  };

  const getMachineStatus = (machineId: number): 'connecting' | 'connected' | 'disconnected' | 'error' | null => {
    if (sessionStatuses[machineId]) {
      return sessionStatuses[machineId];
    }
    if (isSessionOpen(machineId)) {
      return 'connecting';
    }
    return null;
  };

  const statusChar = (status: ReturnType<typeof getMachineStatus>) => {
    if (status === 'connected') return <span className="text-term-green">*</span>;
    if (status === 'connecting') return <span className="text-term-yellow animate-pulse">~</span>;
    if (status === 'error') return <span className="text-term-red">!</span>;
    return <span className="text-term-fg-muted">-</span>;
  };

  const renderMachine = (machine: Machine, inGroup: boolean, isLast: boolean) => {
    const status = getMachineStatus(machine.id);
    const isSelected = selectedMachine?.id === machine.id;

    return (
      <div
        key={machine.id}
        className={`group flex items-center gap-1.5 px-3 py-1 cursor-pointer text-xs transition-colors ${
          isSelected
            ? 'bg-term-cyan/10 text-term-cyan'
            : 'hover:bg-term-surface-alt text-term-fg'
        }`}
        onClick={() => onSelectMachine(machine)}
      >
        {inGroup && (
          <span className="text-term-fg-muted w-5 flex-shrink-0 text-center">
            {isLast ? '\u2514\u2500' : '\u251C\u2500'}
          </span>
        )}

        <span className="w-3 flex-shrink-0 text-center">{statusChar(status)}</span>

        <span className={`truncate ${isSelected ? 'text-term-cyan' : ''}`}>
          {machine.name}
        </span>

        <span className="text-term-fg-muted truncate ml-auto text-right max-w-20 hidden group-hover:hidden">
          {machine.hostname}
        </span>

        <div className="items-center gap-0.5 ml-auto flex-shrink-0 hidden group-hover:flex">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditMachine(machine);
            }}
            className="text-term-fg-dim hover:text-term-fg-bright transition-colors"
            title="Edit"
          >
            [e]
          </button>
          <button
            onClick={(e) => handleDelete(e, machine)}
            className="text-term-fg-dim hover:text-term-red transition-colors"
            title="Delete"
          >
            [x]
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-3">
        <span className="text-term-fg-dim text-xs">loading<span className="cursor-blink"></span></span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-term-border">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-term-fg-dim text-xs tracking-wider uppercase">machines</span>
          <span className="text-term-fg-muted text-xs ml-auto">{machines.length}</span>
        </div>

        {/* Search */}
        <div className="flex items-center gap-1 mb-2">
          <span className="text-term-fg-muted text-xs">/</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="search..."
            className="flex-1 bg-transparent text-term-fg text-xs py-1 focus:outline-none placeholder:text-term-fg-muted border-b border-transparent focus:border-term-border"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={onAddMachine}
            className="flex-1 py-1.5 text-xs border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black transition-colors tracking-wider"
          >
            [ + machine ]
          </button>
          <button
            onClick={() => setShowNewGroupInput(true)}
            className="py-1.5 px-2 text-xs border border-term-border text-term-fg-dim hover:border-term-fg-dim hover:text-term-fg transition-colors"
          >
            [ + group ]
          </button>
        </div>

        {/* New group input */}
        {showNewGroupInput && (
          <div className="mt-2 flex items-center gap-1">
            <span className="text-term-cyan text-xs">&gt;</span>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="group name..."
              className="flex-1 bg-transparent border-b border-term-border text-term-fg-bright text-xs py-1 focus:outline-none focus:border-term-cyan placeholder:text-term-fg-muted"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateGroup();
                if (e.key === 'Escape') {
                  setShowNewGroupInput(false);
                  setNewGroupName('');
                }
              }}
            />
            <button
              onClick={handleCreateGroup}
              className="text-xs text-term-green hover:text-term-black hover:bg-term-green border border-term-green px-2 py-0.5 transition-colors"
            >
              [ok]
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-term-red text-xs">
          <span className="mr-1">[ERR]</span>{error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {machines.length === 0 && !searchQuery ? (
          <div className="px-3 py-4 text-term-fg-muted text-xs">
            no machines added yet
          </div>
        ) : (
          <>
            {/* Grouped machines */}
            {groups.map((group) => {
              const groupMachines = groupedMachines[group.id] || [];
              if (groupMachines.length === 0 && searchQuery) return null;

              const isCollapsed = collapsedGroups.has(group.id);

              return (
                <div key={group.id} className="border-b border-term-border">
                  <div
                    className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-term-surface-alt"
                    onClick={() => toggleGroup(group.id)}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-term-fg-muted w-3 text-center">
                        {isCollapsed ? '+' : '-'}
                      </span>
                      <span
                        className="w-2 h-2 flex-shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="text-term-fg">{group.name}</span>
                      <span className="text-term-fg-muted">({groupMachines.length})</span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteGroup(e, group)}
                      className="text-term-fg-muted hover:text-term-red text-xs transition-colors"
                      title="Delete group"
                    >
                      [x]
                    </button>
                  </div>
                  {!isCollapsed && groupMachines.length > 0 && (
                    <div>
                      {groupMachines.map((m, i) =>
                        renderMachine(m, true, i === groupMachines.length - 1)
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ungrouped machines */}
            {groupedMachines.ungrouped.length > 0 && (
              <div>
                {groups.length > 0 && (
                  <div className="px-3 py-1 text-term-fg-muted text-xs tracking-wider">
                    -- ungrouped --
                  </div>
                )}
                {groupedMachines.ungrouped.map((m, i) =>
                  renderMachine(m, false, i === groupedMachines.ungrouped.length - 1)
                )}
              </div>
            )}

            {/* No results */}
            {searchQuery && Object.values(groupedMachines).every(arr => arr.length === 0) && (
              <div className="px-3 py-4 text-term-fg-muted text-xs">
                no matches
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
