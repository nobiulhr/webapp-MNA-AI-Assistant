import React from 'react';
import { useState, useRef, useEffect } from 'react';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import { ScribeIcon, ChevronDownIcon, ChevronUpIcon } from './components/Icons';
import { processNote, generateSummary, generateExportContent, updateActionItem } from './services/geminiService';
import type { ActionItem, Message, ExportFormat, Status, Priority, TaskType } from './types';
import ExportOptions from './components/ExportOptions';
import ActionItemsList from './components/ActionItemsList';

const App: React.FC = () => {
  const initialMessage: Message = {
    id: `scribe-${Date.now()}`,
    role: 'scribe',
    content: "MNA is ready. Please share your first note, and I'll capture the action items."
  };

  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [actionItems, setActionItems] = useState<ActionItem[]>(() => {
    try {
        const savedItems = localStorage.getItem('scribeActionItems');
        const parsedItems = savedItems ? JSON.parse(savedItems) : [];
        // Data migration: add default status, type, reminder, and unique ID if missing
        return parsedItems.map((item: any, index: number) => ({
            ...item,
            id: item.id || `item-${Date.now()}-${index}`,
            status: item.status || 'Not Started',
            type: item.type || 'Self',
            reminder: item.reminder || 'not set',
        }));
    } catch (error) {
        console.error("Failed to parse action items from local storage:", error);
        return [];
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [editingItem, setEditingItem] = useState<ActionItem | null>(null);
  const [isListVisible, setIsListVisible] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const notifiedRemindersRef = useRef<Record<string, string>>({});

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Register service worker for PWA functionality.
  // This is deferred until the `window.load` event to ensure the document is in a stable,
  // valid state, preventing "invalid state" errors in sandboxed environments.
  useEffect(() => {
    const registerServiceWorker = () => {
      if ('serviceWorker' in navigator) {
        const swUrl = `${window.location.origin}/sw.js`;
        navigator.serviceWorker.register(swUrl)
          .then(registration => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
          }).catch(registrationError => {
            console.log('ServiceWorker registration failed: ', registrationError);
          });
      }
    };

    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
      // Clean up the event listener if the component unmounts before the 'load' event.
      return () => window.removeEventListener('load', registerServiceWorker);
    }
  }, []); // Run only once when the component mounts.

  // Save action items to local storage whenever they change
  useEffect(() => {
    try {
        localStorage.setItem('scribeActionItems', JSON.stringify(actionItems));
    } catch (error) {
        console.error("Failed to save action items to local storage:", error);
    }
  }, [actionItems]);

  // Effect for handling browser notifications for reminders
  useEffect(() => {
      // 1. Request permission on component mount if needed
      if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
          Notification.requestPermission();
      }

      // 2. Set up an interval to check for reminders
      const checkReminders = () => {
          if (Notification.permission !== 'granted') return;

          const now = new Date();
          actionItems.forEach(item => {
              if (item.reminder && item.reminder !== 'not set') {
                  const reminderTime = new Date(item.reminder);
                  // Check if the reminder time is valid and is in the past
                  if (!isNaN(reminderTime.getTime()) && reminderTime <= now) {
                      const lastNotified = notifiedRemindersRef.current[item.id];
                      // Only notify if we haven't notified for this specific reminder time before
                      if (lastNotified !== reminderTime.toISOString()) {
                          const notificationBody = item.priority !== 'None'
                            ? `[${item.priority} Priority] ${item.task}`
                            : item.task;
                          
                          new Notification('MNA AI Reminder', {
                              body: notificationBody,
                              icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0idy02IGgtNiI+CiAgPHBhdGggZD0iTTEwLjc1IDQuNzVhLjc1Ljc1IDAgMDAtMS41IDB2NC41aC00LjVhLjc1Ljc1IDAgMDAwIDEuNWg0LjV2NC41YS43NS43NSAwIDAwMS41IDB2LTQuNWg0LjVhLjc1Ljc1IDAgMDAwLTEuNWgtNC41di00LjV6IiAvPgogIDxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTIxLjUgMTJhOS41IDkuNSAwIDExLTE5IDAgOS41IDkuNSAwIDAxMTkgMHptLTEuNSAwYTggOCAwIDExLTE2IDAgOCA4IDAgMDExNiAweiIgY2xpcC1ydWxlPSJldmVub2RkIiAvPgo8L3N2Zz4K',
                          });
                          // Mark this specific reminder time as notified
                          notifiedRemindersRef.current[item.id] = reminderTime.toISOString();
                      }
                  }
              }
          });
      };

      const intervalId = setInterval(checkReminders, 30000); // Check every 30 seconds

      // 3. Clean up interval on component unmount
      return () => clearInterval(intervalId);
  }, [actionItems]);

  const addMessage = (message: Omit<Message, 'id'>) => {
      const newMessage = { ...message, id: `${message.role}-${Date.now()}-${Math.random()}` };
      setMessages(prev => [...prev, newMessage]);
  }

  const addErrorMessage = (content: string) => {
    addMessage({
        role: 'scribe',
        content: `⚠️ MNA AI Error: ${content}`
    });
  }

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    setIsLoading(true);
    
    const formatName = format === 'csv' ? 'CSV/Excel' : format.toUpperCase();
    addMessage({ role: 'user', content: `Export as ${formatName}` });

    try {
        let responseContent = await generateExportContent(actionItems, format);
        
        // Gemini might wrap the content in markdown code blocks, so we extract it.
        const codeBlockRegex = /```(?:\w*\n)?([\s\S]+?)```/;
        const match = responseContent.match(codeBlockRegex);
        if (match) {
            responseContent = match[1].trim();
        } else {
            responseContent = responseContent.trim();
        }

        const triggerDownload = (content: string, filename: string, mimeType: string) => {
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        let filename = `mna-action-items.${format}`;
        let mimeType = `text/${format}`;

        if (format === 'csv') {
            mimeType = 'text/csv;charset=utf-8;';
        } else if (format === 'json') {
            mimeType = 'application/json';
        } else if (format === 'markdown') {
            filename = 'mna-action-items.md';
            mimeType = 'text/markdown';
        }

        triggerDownload(responseContent, filename, mimeType);
        
        addMessage({ 
            role: 'scribe', 
            content: `Your ${formatName} export has been downloaded.` 
        });

    } catch (error) {
        console.error("Failed to generate export:", error);
        addMessage({
            role: 'scribe',
            content: error instanceof Error ? error.message : "Sorry, I encountered an error while generating the export. Please try again."
        });
    } finally {
        setIsLoading(false);
        setIsExporting(false); 
    }
  }
  
  const handleEditRequest = (itemToEdit: ActionItem) => {
    setEditingItem(itemToEdit);
    addMessage({
        role: 'scribe',
        content: `OK, I'm ready to edit the task: "${itemToEdit.task}". What should I change? Feel free to update the task itself, its deadline, priority, status, or assign it to someone new.`
    });
  };

  const handleInlineUpdate = (itemId: string, updates: Partial<Omit<ActionItem, 'id'>>) => {
    setActionItems(prevItems =>
        prevItems.map(item =>
            item.id === itemId
                ? { ...item, ...updates }
                : item
        )
    );
  };

  const handleSelectionChange = (itemId: string, isSelected: boolean) => {
    setSelectedItems(prevSelected => {
        const newSelected = new Set(prevSelected);
        if (isSelected) {
            newSelected.add(itemId);
        } else {
            newSelected.delete(itemId);
        }
        return newSelected;
    });
  };

  const handleSelectItems = (itemIds: string[]) => {
    setSelectedItems(prev => new Set([...prev, ...itemIds]));
  };

  const handleDeselectItems = (itemIds: string[]) => {
      setSelectedItems(prev => {
          const newSet = new Set(prev);
          itemIds.forEach(id => newSet.delete(id));
          return newSet;
      });
  };

  const handleClearSelection = () => {
    setSelectedItems(new Set());
  };

  const handleBulkUpdate = (field: 'status' | 'priority' | 'type', value: Status | Priority | TaskType) => {
    if (selectedItems.size === 0 || !value) return;

    setActionItems(prevItems =>
        prevItems.map(item =>
            selectedItems.has(item.id)
                ? { ...item, [field]: value }
                : item
        )
    );

    addMessage({
        role: 'scribe',
        content: `Updated ${field} for ${selectedItems.size} item(s) to "${value}".`
    });

    setSelectedItems(new Set()); // Clear selection
  };

  const handleBulkDelete = () => {
    if (selectedItems.size === 0) return;

    setActionItems(prevItems =>
        prevItems.filter(item => !selectedItems.has(item.id))
    );

    addMessage({
        role: 'scribe',
        content: `Deleted ${selectedItems.size} item(s).`
    });

    setSelectedItems(new Set()); // Clear selection
  };


  const handleSend = async (userInput: string) => {
    addMessage({ role: 'user', content: userInput });

    if (editingItem) {
      setIsLoading(true);
      try {
        const updatedItemFromApi = await updateActionItem(editingItem, userInput);
        const updatedItem: ActionItem = { ...updatedItemFromApi, id: editingItem.id };
        
        setActionItems(prevItems =>
          prevItems.map(item =>
            item.id === editingItem.id
              ? updatedItem
              : item
          )
        );

        addMessage({
          role: 'scribe',
          content: `Got it. I've updated the task to "${updatedItem.task}", assigned to ${updatedItem.responsible}, due by ${updatedItem.deadline}, with ${updatedItem.priority} priority and status set to ${updatedItem.status}. Do you have more to add, or would you like me to generate the final summary?`
        });

      } catch (error) {
        console.error("Failed to update item:", error);
        addMessage({
          role: 'scribe',
          content: error instanceof Error ? error.message : "Sorry, I had trouble updating that. Please try again."
        });
      } finally {
        setEditingItem(null);
        setIsLoading(false);
      }
      return;
    }
    
    const lowercasedInput = userInput.toLowerCase();

    const editMatch = lowercasedInput.match(/^edit (?:task|item) ['"](.+?)['"]/i);
    if (editMatch) {
        const taskNameToEdit = editMatch[1];
        const itemToEdit = actionItems.find(item => item.task.toLowerCase() === taskNameToEdit.toLowerCase());

        if (itemToEdit) {
            handleEditRequest(itemToEdit);
        } else {
            addMessage({
                role: 'scribe',
                content: `Sorry, I couldn't find a task named "${taskNameToEdit}". Please check the name (including quotes) and try again.`
            });
        }
        return;
    }
    
    if (lowercasedInput.includes('download') || lowercasedInput.includes('export')) {
        addMessage({
            role: 'scribe',
            content: <ExportOptions onSelect={handleExport} disabled={isExporting} />
        });
        return;
    }

    setIsLoading(true);
    try {
      let responseContent: string;
      let isSummary = false;

      if (lowercasedInput.includes('generate the final summary') || lowercasedInput.includes('generate summary')) {
        responseContent = await generateSummary(actionItems);
        isSummary = true;
      } else {
        const scribeResponse = await processNote(userInput, actionItems);
        responseContent = scribeResponse.responseText;
        if (scribeResponse.newItems.length > 0) {
          const itemsWithIds: ActionItem[] = scribeResponse.newItems.map((item, index) => ({
              ...item,
              id: `item-${Date.now()}-${index}`
          }));
          setActionItems(prev => [...prev, ...itemsWithIds]);
        }
      }
      addMessage({ role: 'scribe', content: responseContent, isSummary: isSummary });
    } catch (error) {
      console.error("Failed to get response from MNA AI:", error);
      addMessage({
        role: 'scribe',
        content: error instanceof Error ? error.message : "Sorry, I encountered an error. Please check the console for details or try again."
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans text-white bg-slate-900">
      <header className="p-4 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScribeIcon className="w-8 h-8 text-indigo-400"/>
            <h1 className="text-xl font-bold tracking-tight">MNA AI Assistant</h1>
          </div>
          <button
            onClick={() => setIsListVisible(!isListVisible)}
            className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
            aria-expanded={isListVisible}
            aria-controls="action-items-list"
          >
            {isListVisible ? 'Hide List' : 'Show List'}
            {isListVisible ? <ChevronUpIcon className="w-5 h-5"/> : <ChevronDownIcon className="w-5 h-5"/>}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-2 sm:p-4">
        <div className="max-w-4xl mx-auto">
          {isListVisible && (
            <ActionItemsList 
                items={actionItems} 
                onUpdateItem={handleInlineUpdate}
                selectedItems={selectedItems}
                onSelectionChange={handleSelectionChange}
                onSelectItems={handleSelectItems}
                onDeselectItems={handleDeselectItems}
                onClearSelection={handleClearSelection}
                onBulkUpdate={handleBulkUpdate}
                onBulkDelete={handleBulkDelete}
                onExport={handleExport}
                isExporting={isExporting}
            />
          )}
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {isLoading && (
             <div className="flex items-start gap-3 my-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-indigo-500">
                    <ScribeIcon className="w-6 h-6 text-white" />
                </div>
                <div className="relative p-4 rounded-xl max-w-lg bg-slate-800 rounded-tl-none">
                   <div className="flex items-center gap-2">
                       <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span>
                       <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" style={{ animationDelay: '200ms' }}></span>
                       <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" style={{ animationDelay: '400ms' }}></span>
                   </div>
                </div>
             </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </main>

      <footer className="sticky bottom-0">
        <ChatInput onSend={handleSend} isLoading={isLoading} onError={addErrorMessage} />
      </footer>
    </div>
  );
};

export default App;