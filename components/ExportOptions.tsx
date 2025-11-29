
import React from 'react';
import type { ExportFormat } from '../types';

interface ExportOptionsProps {
    onSelect: (format: ExportFormat) => void;
    disabled: boolean;
}

const ExportOptions: React.FC<ExportOptionsProps> = ({ onSelect, disabled }) => {
    const formats: { label: string; format: ExportFormat }[] = [
        { label: 'Markdown', format: 'markdown' },
        { label: 'JSON', format: 'json' },
        { label: 'CSV', format: 'csv' },
        { label: 'Excel', format: 'csv' },
    ];

    return (
        <div className="mt-3">
            <p className="text-sm font-medium mb-2 text-slate-300">Choose an export format:</p>
            <div className="flex flex-wrap gap-2">
                {formats.map(({ label, format }) => (
                    <button
                        key={label}
                        onClick={() => onSelect(format)}
                        disabled={disabled}
                        className="px-4 py-2 text-sm font-semibold bg-slate-700 text-white rounded-md hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default ExportOptions;
