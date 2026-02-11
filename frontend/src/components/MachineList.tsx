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

  // Group machines by group_id
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

  // Get machine status - show status if machine is in openSessions OR has a reported status
  // (machines can have status if they're in a split pane even if not the primary session)
  const getMachineStatus = (machineId: number): 'connecting' | 'connected' | 'disconnected' | 'error' | null => {
    // If we have a status for this machine (either from primary session or split pane), show it
    if (sessionStatuses[machineId]) {
      return sessionStatuses[machineId];
    }
    // If machine is in open sessions but no status yet, show connecting
    if (isSessionOpen(machineId)) {
      return 'connecting';
    }
    return null;
  };

  const renderMachine = (machine: Machine) => {
    const status = getMachineStatus(machine.id);
    
    return (
      <li
        key={machine.id}
        className={`p-3 pl-6 cursor-pointer hover:bg-slate-800 transition-colors ${
          selectedMachine?.id === machine.id ? 'bg-slate-800' : ''
        }`}
        onClick={() => onSelectMachine(machine)}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {status && (
                <span 
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    status === 'connected' ? 'bg-green-500' :
                    status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                    status === 'error' ? 'bg-red-500' :
                    'bg-slate-500'
                  }`} 
                  title={status === 'connected' ? 'Connected' : 
                         status === 'connecting' ? 'Connecting...' :
                         status === 'error' ? 'Error' : 'Disconnected'} 
                />
              )}
              <h3 className="text-white font-medium truncate text-sm">{machine.name}</h3>
            </div>
            <p className="text-slate-400 text-xs truncate">
              {machine.username}@{machine.hostname}
            </p>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditMachine(machine);
              }}
              className="p-1 text-slate-400 hover:text-white transition-colors"
              title="Edit"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={(e) => handleDelete(e, machine)}
              className="p-1 text-slate-400 hover:text-red-400 transition-colors"
              title="Delete"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </li>
    );
  };

  if (loading) {
    return (
      <div className="p-4 text-slate-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-white">Machines</h2>
        <div className="mt-2 relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search machines..."
            className="w-full px-3 py-2 pl-9 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={onAddMachine}
            className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors"
          >
            + Machine
          </button>
          <button
            onClick={() => setShowNewGroupInput(true)}
            className="py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm font-medium transition-colors"
            title="New Group"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        </div>

        {/* New group input */}
        {showNewGroupInput && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name..."
              className="flex-1 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm"
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
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 text-red-400 text-sm">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {machines.length === 0 && !searchQuery ? (
          <div className="p-4 text-slate-500 text-sm">
            No machines added yet. Click "+ Machine" to get started.
          </div>
        ) : (
          <>
            {/* Grouped machines */}
            {groups.map((group) => {
              const groupMachines = groupedMachines[group.id] || [];
              if (groupMachines.length === 0 && searchQuery) return null;

              const isCollapsed = collapsedGroups.has(group.id);

              return (
                <div key={group.id} className="border-b border-slate-700">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-800/50"
                    onClick={() => toggleGroup(group.id)}
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <div
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="text-slate-300 font-medium text-sm">{group.name}</span>
                      <span className="text-slate-500 text-xs">({groupMachines.length})</span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteGroup(e, group)}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                      title="Delete group"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {!isCollapsed && groupMachines.length > 0 && (
                    <ul>{groupMachines.map(renderMachine)}</ul>
                  )}
                </div>
              );
            })}

            {/* Ungrouped machines */}
            {groupedMachines.ungrouped.length > 0 && (
              <div>
                {groups.length > 0 && (
                  <div className="p-3 text-slate-500 text-xs uppercase tracking-wide">
                    Ungrouped
                  </div>
                )}
                <ul>
                  {groupedMachines.ungrouped.map(renderMachine)}
                </ul>
              </div>
            )}

            {/* No results message */}
            {searchQuery && Object.values(groupedMachines).every(arr => arr.length === 0) && (
              <div className="p-4 text-slate-500 text-sm">
                No machines match your search.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
