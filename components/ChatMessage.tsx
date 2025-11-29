

import React from 'react';
import type { Message } from '../types';
import { ScribeIcon, UserIcon } from './Icons';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isScribe = message.role === 'scribe';

  const renderContent = (content: string) => {
    // Convert markdown code blocks to <pre><code> for nice display
    const htmlWithCodeBlocks = content.replace(/```(\w*)\n([\s\S]+?)\n```/g, (_, lang, code) => {
      const escapedCode = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre><code class="language-${lang || ''}">${escapedCode}</code></pre>`;
    });

    // Convert remaining newlines to <br>, but not inside <pre> tags
    const finalHtml = htmlWithCodeBlocks.split(/(<pre>[\s\S]+?<\/pre>)/g).map((part, index) => {
      if (index % 2 === 1) { // It's a pre-tag part, leave it as is
        return part;
      }
      return part.replace(/\n/g, '<br />'); // It's a normal text part
    }).join('');

    return finalHtml;
  };

  return (
    <div className={`flex items-start gap-3 my-4 ${isScribe ? '' : 'flex-row-reverse'}`}>
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          isScribe ? 'bg-indigo-500' : 'bg-slate-600'
        }`}
      >
        {isScribe ? (
          <ScribeIcon className="w-6 h-6 text-white" />
        ) : (
          <UserIcon className="w-6 h-6 text-white" />
        )}
      </div>
      <div
        className={`relative p-4 rounded-xl max-w-full sm:max-w-lg lg:max-w-2xl prose prose-invert prose-p:my-0 prose-headings:my-2 prose-pre:bg-slate-900/70 ${
          isScribe ? 'bg-slate-800 rounded-tl-none' : 'bg-sky-700 text-white rounded-tr-none'
        } ${message.isSummary ? 'prose-sm sm:prose-base' : ''}`}
      >
        {typeof message.content === 'string' ? (
             <div dangerouslySetInnerHTML={{ __html: renderContent(message.content) }} />
        ) : (
            message.content
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
