import React, { useState, useMemo } from 'react';
import type { ActionItem, Priority, Status, ExportFormat, TaskType } from '../types';
import { DownloadIcon, BellIcon, CalendarIcon, TrashIcon } from './Icons';
import ExportOptions from './ExportOptions';

interface ActionItemsListProps {
  items: ActionItem[];
  onUpdateItem: (itemId: string, updates: Partial<Omit<ActionItem, 'id'>>) => void;
  selectedItems: Set<string>;
  onSelectionChange: (itemId: string, isSelected: boolean) => void;
  onSelectItems: (itemIds: string[]) => void;
  onDeselectItems: (itemIds: string[]) => void;
  onClearSelection: () => void;
  onBulkUpdate: (field: 'status' | 'priority' | 'type', value: Status | Priority | TaskType) => void;
  onBulkDelete: () => void;
  onExport: (format: ExportFormat) => void;
  isExporting: boolean;
}

const priorityConfig: { [key in Priority]: { color: string; order: number } } = {
  'High': { color: 'bg-red-500', order: 1 },
  'Medium': { color: 'bg-yellow-500', order: 2 },
  'Low': { color: 'bg-green-500', order: 3 },
  'None': { color: 'bg-slate-500', order: 4 },
};

const statusConfig: { [key in Status]: { color: string; order: number } } = {
  'In Progress': { color: 'bg-blue-500', order: 1 },
  'Not Started': { color: 'bg-slate-500', order: 2 },
  'Completed': { color: 'bg-green-500', order: 3 },
};

const typeConfig: { [key in TaskType]: { color: string; order: number } } = {
    'Self': { color: 'bg-sky-600', order: 1 },
    'Delegated': { color: 'bg-orange-500', order: 2 },
    'Team': { color: 'bg-purple-500', order: 3 },
    'Personal': { color: 'bg-teal-500', order: 4 },
};

// Helper to format a date string for display
const formatDateForDisplay = (dateString: string): string => {
    if (!dateString || dateString === 'not set') return 'Set reminder';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return dateString; // Return original if not a valid date (e.g., "Tomorrow")
    }
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
    });
};

// Helper to format a date string for the datetime-local input
const formatDateForInput = (dateString: string): string => {
    if (!dateString || dateString === 'not set') return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
};


const FilterControls: React.FC<{
    sortBy: string; setSortBy: (val: any) => void;
    filterByPriority: string; setFilterByPriority: (val: any) => void;
    filterByStatus: string; setFilterByStatus: (val: any) => void;
    filterByType: string; setFilterByType: (val: any) => void;
}> = ({ sortBy, setSortBy, filterByPriority, setFilterByPriority, filterByStatus, setFilterByStatus, filterByType, setFilterByType }) => (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
        <label htmlFor="sort-by" className="text-sm font-medium text-slate-300">Sort by:</label>
        <select
            id="sort-by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
        >
            <option value="priority">Priority</option>
            <option value="status">Status</option>
            <option value="type">Type</option>
            <option value="deadline">Deadline</option>
            <option value="reminder">Reminder</option>
            <option value="task">Task</option>
            <option value="responsible">Responsible</option>
        </select>
        </div>
        <div className="flex items-center gap-2">
        <label htmlFor="filter-by-priority" className="text-sm font-medium text-slate-300">Priority:</label>
        <select
            id="filter-by-priority"
            value={filterByPriority}
            onChange={(e) => setFilterByPriority(e.target.value as any)}
            className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
        >
            <option value="all">All</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
            <option value="None">None</option>
        </select>
        </div>
        <div className="flex items-center gap-2">
        <label htmlFor="filter-by-status" className="text-sm font-medium text-slate-300">Status:</label>
        <select
            id="filter-by-status"
            value={filterByStatus}
            onChange={(e) => setFilterByStatus(e.target.value as any)}
            className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
        >
            <option value="all">All</option>
            <option value="Not Started">Not Started</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
        </select>
        </div>
        <div className="flex items-center gap-2">
        <label htmlFor="filter-by-type" className="text-sm font-medium text-slate-300">Type:</label>
        <select
            id="filter-by-type"
            value={filterByType}
            onChange={(e) => setFilterByType(e.target.value as any)}
            className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
        >
            <option value="all">All</option>
            <option value="Self">Self</option>
            <option value="Delegated">Delegated</option>
            <option value="Team">Team</option>
            <option value="Personal">Personal</option>
        </select>
        </div>
    </div>
);

const BulkEditToolbar: React.FC<{
    selectedCount: number;
    onBulkUpdate: (field: 'status' | 'priority' | 'type', value: Status | Priority | TaskType) => void;
    onBulkDelete: () => void;
    onCancel: () => void;
}> = ({ selectedCount, onBulkUpdate, onBulkDelete, onCancel }) => {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const statusOptions: Status[] = ['Not Started', 'In Progress', 'Completed'];

    if (isConfirmingDelete) {
        return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-sm font-medium text-yellow-300">Delete {selectedCount} item(s)?</p>
                <button
                    onClick={() => {
                        onBulkDelete();
                        setIsConfirmingDelete(false);
                    }}
                    className="px-3 py-1 text-sm font-semibold bg-red-600 text-white rounded-md hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-red-500"
                >
                    Confirm Delete
                </button>
                <button
                    onClick={() => setIsConfirmingDelete(false)}
                    className="text-sm text-slate-300 hover:text-white"
                >
                    Cancel
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm font-medium text-slate-100">{selectedCount} item(s) selected</p>
            
            <div className="flex items-center gap-2">
                <span className="text-sm text-slate-300">Set status:</span>
                {statusOptions.map(status => (
                    <button
                        key={status}
                        onClick={() => onBulkUpdate('status', status)}
                        className="px-2 py-1 text-xs font-semibold bg-slate-700 text-white rounded-md hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500 transition-colors"
                    >
                        {status}
                    </button>
                ))}
            </div>

            <div className="flex items-center gap-2">
                <label htmlFor="bulk-edit-type" className="text-sm sr-only">Type</label>
                <select
                    id="bulk-edit-type"
                    onChange={(e) => {
                         if (e.target.value) {
                            onBulkUpdate('type', e.target.value as TaskType);
                            e.target.value = "";
                        }
                    }}
                    className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                >
                    <option value="">Change type...</option>
                    <option value="Self">Self</option>
                    <option value="Delegated">Delegated</option>
                    <option value="Team">Team</option>
                    <option value="Personal">Personal</option>
                </select>
            </div>

             <div className="flex items-center gap-2">
                <label htmlFor="bulk-edit-priority" className="text-sm sr-only">Priority</label>
                <select
                    id="bulk-edit-priority"
                    onChange={(e) => {
                         if (e.target.value) {
                            onBulkUpdate('priority', e.target.value as Priority);
                            e.target.value = "";
                        }
                    }}
                    className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                >
                    <option value="">Change priority...</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                    <option value="None">None</option>
                </select>
            </div>
            <div className="h-4 border-l border-slate-600 mx-2"></div>
             <button
                onClick={() => setIsConfirmingDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1 text-sm font-semibold bg-red-800/80 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-red-500 transition-colors"
                title="Delete selected items"
            >
                <TrashIcon className="w-4 h-4" />
                <span>Delete</span>
            </button>
            <button onClick={onCancel} className="text-sm text-indigo-400 hover:text-indigo-300">Cancel</button>
        </div>
    );
};

const generateICSContent = (items: ActionItem[]): string | null => {
    const events = items.map(item => {
        let startDate: Date | null = null;
        let endDate: Date | null = null;
        let isAllDay = false;

        if (item.reminder && item.reminder !== 'not set') {
            const reminderDate = new Date(item.reminder);
            if (!isNaN(reminderDate.getTime())) {
                startDate = reminderDate;
                endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration
            }
        }

        if (!startDate && item.deadline && item.deadline !== 'not specified') {
             const deadlineDate = new Date(item.deadline);
             if (!isNaN(deadlineDate.getTime())) {
                 if (/[:]|(am)|(pm)/i.test(item.deadline)) {
                    startDate = deadlineDate;
                    endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration
                 } else {
                    startDate = deadlineDate;
                    isAllDay = true;
                 }
             }
        }
        
        if (!startDate) return null;

        const toICSDate = (date: Date, isAllDayEvent: boolean) => {
            if (isAllDayEvent) {
                return date.toISOString().split('T')[0].replace(/-/g, '');
            }
            return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        };

        const formatString = (str: string) => {
            return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
        };
        
        const description = `Priority: ${item.priority}\\nStatus: ${item.status}\\nType: ${item.type}\\nResponsible: ${item.responsible}\\nSource Note: ${formatString(item.source)}`;

        let eventString = [
            'BEGIN:VEVENT',
            `UID:${item.id}@mna-ai.app`,
            `DTSTAMP:${toICSDate(new Date(), false)}`,
            `SUMMARY:${formatString(item.task)}`,
            `DESCRIPTION:${description}`,
        ];

        if (isAllDay) {
            eventString.push(`DTSTART;VALUE=DATE:${toICSDate(startDate, true)}`);
        } else {
            eventString.push(`DTSTART:${toICSDate(startDate, false)}`);
            if (endDate) {
                eventString.push(`DTEND:${toICSDate(endDate, false)}`);
            }
        }
        
        eventString.push('END:VEVENT');
        return eventString.join('\r\n');

    }).filter(Boolean).join('\r\n');

    if (!events) {
        return null;
    }

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//MNAAI//Action Items Calendar//EN',
        events,
        'END:VCALENDAR'
    ].join('\r\n');
};


const ActionItemsList: React.FC<ActionItemsListProps> = ({ items, onUpdateItem, selectedItems, onSelectionChange, onSelectItems, onDeselectItems, onClearSelection, onBulkUpdate, onBulkDelete, onExport, isExporting }) => {
  const [sortBy, setSortBy] = useState<'priority' | 'deadline' | 'task' | 'responsible' | 'status' | 'type' | 'reminder'>('priority');
  const [filterByPriority, setFilterByPriority] = useState<Priority | 'all'>('all');
  const [filterByStatus, setFilterByStatus] = useState<Status | 'all'>('all');
  const [filterByType, setFilterByType] = useState<TaskType | 'all'>('all');

  const [editingField, setEditingField] = useState<{ itemId: string; field: 'task' | 'deadline' | 'responsible' | 'reminder' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showExportOptions, setShowExportOptions] = useState(false);

  const sortedAndFilteredItems = useMemo(() => {
    let processedItems = [...items];

    // Filter
    if (filterByPriority !== 'all') {
      processedItems = processedItems.filter(item => item.priority === filterByPriority);
    }
    if (filterByStatus !== 'all') {
      processedItems = processedItems.filter(item => item.status === filterByStatus);
    }
    if (filterByType !== 'all') {
      processedItems = processedItems.filter(item => item.type === filterByType);
    }

    // Sort
    processedItems.sort((a, b) => {
      if (sortBy === 'status') {
        return statusConfig[a.status].order - statusConfig[b.status].order;
      }
      if (sortBy === 'priority') {
        return priorityConfig[a.priority].order - priorityConfig[b.priority].order;
      }
      if (sortBy === 'type') {
        return typeConfig[a.type].order - typeConfig[b.type].order;
      }
      if (sortBy === 'deadline') {
        if (a.deadline === 'not specified' && b.deadline !== 'not specified') return 1;
        if (a.deadline !== 'not specified' && b.deadline === 'not specified') return -1;
        return a.deadline.localeCompare(b.deadline);
      }
      if (sortBy === 'reminder') {
        if (a.reminder === 'not set' && b.reminder !== 'not set') return 1;
        if (a.reminder !== 'not set' && b.reminder === 'not set') return -1;
        if (a.reminder === 'not set' && b.reminder === 'not set') return 0;
        
        const dateA = new Date(a.reminder).getTime();
        const dateB = new Date(b.reminder).getTime();
        
        if (isNaN(dateA) && !isNaN(dateB)) return 1;
        if (!isNaN(dateA) && isNaN(dateB)) return -1;

        return dateA - dateB;
      }
      if (sortBy === 'responsible') {
        return a.responsible.localeCompare(b.responsible);
      }
      return a.task.localeCompare(b.task);
    });

    return processedItems;
  }, [items, sortBy, filterByPriority, filterByStatus, filterByType]);

  const handleEditStart = (item: ActionItem, field: 'task' | 'deadline' | 'responsible' | 'reminder') => {
      setEditingField({ itemId: item.id, field });
      if (field === 'reminder') {
          setEditValue(formatDateForInput(item.reminder));
      } else {
          setEditValue(item[field]);
      }
  };

  const handleEditCancel = () => {
      setEditingField(null);
      setEditValue('');
  };

  const handleEditSave = () => {
      if (!editingField) return;
      
      const finalValue = (editingField.field === 'reminder' && !editValue) ? 'not set' : editValue;

      const originalItem = items.find(i => i.id === editingField.itemId);
      if (originalItem && originalItem[editingField.field] === finalValue) {
          handleEditCancel();
          return;
      }

      onUpdateItem(editingField.itemId, { [editingField.field]: finalValue });
      handleEditCancel();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleEditSave();
      } else if (e.key === 'Escape') {
          handleEditCancel();
      }
  };

  const handleCalendarExport = () => {
    const icsContent = generateICSContent(items);
    if (icsContent) {
        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mna-tasks.ics';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } else {
        alert("No action items with valid dates found to export to calendar.");
    }
  };


  if (items.length === 0) {
    return (
        <div id="action-items-list" className="mb-6 p-4 bg-slate-800/50 border border-slate-700 rounded-lg text-center">
            <p className="text-slate-400">Your action items will appear here once you add them.</p>
        </div>
    );
  }

  const isAnythingSelected = selectedItems.size > 0;
  const areAllVisibleSelected = sortedAndFilteredItems.length > 0 && sortedAndFilteredItems.every(item => selectedItems.has(item.id));

  const handleToggleSelectAll = () => {
    const visibleIds = sortedAndFilteredItems.map(item => item.id);
    if (areAllVisibleSelected) {
        onDeselectItems(visibleIds);
    } else {
        onSelectItems(visibleIds);
    }
  };


  return (
    <div id="action-items-list" className="mb-6 bg-slate-800/50 border border-slate-700 rounded-lg">
      <div className="p-4 border-b border-slate-700 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center min-h-[64px]">
        <div className="flex items-center gap-3">
             <input
                type="checkbox"
                className="form-checkbox h-5 w-5 rounded bg-slate-700 border-slate-600 text-indigo-600 focus:ring-indigo-500 shrink-0"
                checked={areAllVisibleSelected}
                onChange={handleToggleSelectAll}
                aria-label={areAllVisibleSelected ? "Deselect all visible items" : "Select all visible items"}
                title={areAllVisibleSelected ? "Deselect all visible items" : "Select all visible items"}
             />
            <h2 className="text-lg font-bold">Action Items ({items.length})</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            {isAnythingSelected ? (
                <BulkEditToolbar 
                    selectedCount={selectedItems.size}
                    onBulkUpdate={onBulkUpdate}
                    onBulkDelete={onBulkDelete}
                    onCancel={onClearSelection}
                />
            ) : (
                <FilterControls 
                    sortBy={sortBy} setSortBy={setSortBy}
                    filterByPriority={filterByPriority} setFilterByPriority={setFilterByPriority}
                    filterByStatus={filterByStatus} setFilterByStatus={setFilterByStatus}
                    filterByType={filterByType} setFilterByType={setFilterByType}
                />
            )}
             <button
              onClick={handleCalendarExport}
              disabled={items.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold bg-slate-700 text-white rounded-md hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Add to Calendar"
            >
              <CalendarIcon className="w-4 h-4" />
              <span>Calendar</span>
            </button>
            <button
              onClick={() => setShowExportOptions(!showExportOptions)}
              disabled={items.length === 0 || isExporting}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold bg-slate-700 text-white rounded-md hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-expanded={showExportOptions}
              title="Export action items"
            >
              <DownloadIcon className="w-4 h-4" />
              <span>Export</span>
            </button>
        </div>
      </div>
      {showExportOptions && (
        <div className="p-4 border-b border-slate-700 bg-slate-900/50">
            <ExportOptions
                onSelect={(format) => {
                    onExport(format);
                    setShowExportOptions(false);
                }}
                disabled={isExporting}
            />
        </div>
      )}
      <ul className="divide-y divide-slate-700 max-h-[60vh] overflow-y-auto">
        {sortedAndFilteredItems.length > 0 ? (
            sortedAndFilteredItems.map((item) => (
            <li key={item.id} className="p-4 flex items-start gap-3 sm:gap-4 hover:bg-slate-800 transition-colors">
              <input
                type="checkbox"
                className="form-checkbox h-5 w-5 rounded bg-slate-700 border-slate-600 text-indigo-600 focus:ring-indigo-500 shrink-0 mt-1"
                checked={selectedItems.has(item.id)}
                onChange={(e) => onSelectionChange(item.id, e.target.checked)}
                aria-label={`Select task: ${item.task}`}
              />
              <span 
                className={`mt-2 w-3 h-3 rounded-full flex-shrink-0 ${priorityConfig[item.priority].color}`}
                title={`Priority: ${item.priority}`}
              ></span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-1 sm:gap-4">
                  {editingField?.itemId === item.id && editingField?.field === 'task' ? (
                      <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleEditSave}
                          onKeyDown={handleInputKeyDown}
                          className="w-full bg-slate-900/80 text-white rounded-md p-1 -m-1 focus:ring-1 focus:ring-indigo-500"
                          autoFocus
                          rows={2}
                      />
                  ) : (
                      <p 
                        role="button"
                        tabIndex={0}
                        onClick={() => handleEditStart(item, 'task')} 
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEditStart(item, 'task'); }}}
                        className="font-medium text-slate-100 cursor-pointer flex-1 break-words">
                            {item.task}
                      </p>
                  )}
                  {editingField?.itemId === item.id && editingField?.field === 'responsible' ? (
                       <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleEditSave}
                          onKeyDown={handleInputKeyDown}
                          className="w-full sm:w-32 bg-slate-900/80 text-white rounded-md p-1 -m-1 text-left sm:text-right text-sm focus:ring-1 focus:ring-indigo-500"
                          autoFocus
                      />
                  ) : (
                    <p 
                        role="button"
                        tabIndex={0}
                        onClick={() => handleEditStart(item, 'responsible')} 
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEditStart(item, 'responsible'); }}}
                        className="text-sm font-medium text-slate-300 text-left sm:text-right flex-shrink-0 cursor-pointer">
                            {item.responsible}
                    </p>
                  )}
                </div>
                <div className="text-sm text-slate-400 mt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
                         {editingField?.itemId === item.id && editingField?.field === 'deadline' ? (
                             <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleEditSave}
                                onKeyDown={handleInputKeyDown}
                                className="w-40 bg-slate-900/80 text-white rounded-md p-1 -m-1 focus:ring-1 focus:ring-indigo-500"
                                autoFocus
                            />
                         ) : (
                            <span 
                                role="button"
                                tabIndex={0}
                                onClick={() => handleEditStart(item, 'deadline')} 
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEditStart(item, 'deadline'); }}}
                                className="cursor-pointer p-1 -m-1 rounded hover:bg-slate-700/50">
                                Due by: {item.deadline === 'not specified' ? 'Not specified' : item.deadline}
                            </span>
                         )}
                        {editingField?.itemId === item.id && editingField?.field === 'reminder' ? (
                             <input
                                type="datetime-local"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleEditSave}
                                onKeyDown={handleInputKeyDown}
                                className="w-48 bg-slate-900/80 text-white rounded-md p-1 -m-1 focus:ring-1 focus:ring-indigo-500"
                                autoFocus
                            />
                         ) : (
                            <span 
                                role="button"
                                tabIndex={0}
                                onClick={() => handleEditStart(item, 'reminder')} 
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEditStart(item, 'reminder'); }}}
                                className="flex items-center gap-1 cursor-pointer p-1 -m-1 rounded hover:bg-slate-700/50"
                                title="Set or edit reminder"
                            >
                                <BellIcon className="w-4 h-4" />
                                <span>{formatDateForDisplay(item.reminder)}</span>
                            </span>
                         )}
                    </div>
                     <div className="flex items-center gap-2 self-start sm:self-center">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusConfig[item.status].color} text-white`}>
                            {item.status}
                        </span>
                         <select
                            value={item.type}
                            onChange={(e) => onUpdateItem(item.id, { type: e.target.value as TaskType })}
                            className={`px-2 py-0.5 text-xs font-semibold rounded-full ${typeConfig[item.type].color} text-white border-none appearance-none cursor-pointer focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-400`}
                            style={{ backgroundColor: typeConfig[item.type].color }}
                        >
                            <option value="Self">Self</option>
                            <option value="Delegated">Delegated</option>
                            <option value="Team">Team</option>
                            <option value="Personal">Personal</option>
                        </select>
                    </div>
                </div>
              </div>
            </li>
            ))
        ) : (
            <li className="p-4 text-center text-slate-400">No items match your filters.</li>
        )}
      </ul>
    </div>
  );
};

export default ActionItemsList;