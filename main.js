const { Plugin } = require('obsidian');

module.exports = class AutoQuotesPlugin extends Plugin {
    async onload() {
        console.log('Auto Quotes Replacer loaded');
        
        this.highlightMarks = [];
        this.highlightTimeout = null;
        
        this.addStyle();
        
        this.registerCodeMirror((cm) => {
            cm.on('change', this.handleChange.bind(this));
        });
        
        this.addCommand({
            id: 'replace-quotes',
            name: 'Заменить кавычки в текущем файле',
            editorCallback: (editor) => {
                this.replaceInEditor(editor);
            }
        });
    }
    
    addStyle() {
        const style = document.createElement('style');
        style.id = 'auto-quotes-highlight';
        style.textContent = `
            .quote-highlight {
                background-color: var(--background-modifier-success);
                color: var(--text-normal) !important;
                border-radius: 2px;
                animation: quotePulse 2s ease-in-out;
            }
            
            @keyframes quotePulse {
                0% { 
                    background-color: var(--background-modifier-success);
                    box-shadow: 0 0 3px var(--background-modifier-success);
                }
                50% { 
                    background-color: var(--background-modifier-success-hover);
                    box-shadow: 0 0 8px var(--background-modifier-success);
                }
                100% { 
                    background-color: transparent;
                    box-shadow: none;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    showNotification(replacedCount) {
        let message;
        if (replacedCount === 1) {
            message = `Заменена 1 кавычка`;
        } else if (replacedCount >= 2 && replacedCount <= 4) {
            message = `Заменены ${replacedCount} кавычки`;
        } else {
            message = `Заменено ${replacedCount} кавычек`;
        }
        
        new Notice(message, 3000);
    }
    
    handleChange(cm, change) {
        const isUserInput = change.origin === 'paste' || 
                           change.origin === '+input' || 
                           change.origin === 'input' ||
                           !change.origin;
        
        if (!isUserInput) {
            return;
        }
        
        const hasQuotes = change.text && change.text.some(text => 
            text && (text.includes('<<') || text.includes('>>'))
        );
        
        if (!hasQuotes) {
            return;
        }
        
        const doc = cm.getDoc();
        const originalContent = doc.getValue();
        const originalCursor = doc.getCursor();
        const originalSelections = doc.listSelections();
        const scrollInfo = cm.getScrollInfo();
        
        const result = this.replaceQuotes(originalContent);
        
        if (result.replacedCount > 0) {
            const newCursor = this.calculateNewCursorPosition(originalCursor, originalContent, result.content);
            const newSelections = this.calculateNewSelections(originalSelections, originalContent, result.content);
            
            this.applyChangesAsTransaction(doc, originalContent, result.content);
            
            this.restoreEditorState(doc, newCursor, newSelections, scrollInfo, cm);
            
            this.highlightFrenchQuotes(cm);
            
            this.showNotification(result.replacedCount);
        }
    }
    
    replaceQuotes(content) {
        let replacedCount = 0;
        let lastIndex = 0;
        const segments = [];
        
        const processPattern = (pattern, replacement) => {
            let match;
            const regex = new RegExp(pattern, 'g');
            
            while ((match = regex.exec(content)) !== null) {
                segments.push(content.slice(lastIndex, match.index));
                segments.push(replacement);
                replacedCount++;
                lastIndex = regex.lastIndex;
            }
        };
        
        processPattern('<<', '«');
        
        const afterOpenQuotes = content.slice(lastIndex);
        lastIndex = 0;
        const finalSegments = [...segments];
        segments.length = 0;
        
        let closeMatch;
        const closeRegex = />>/g;
        
        while ((closeMatch = closeRegex.exec(afterOpenQuotes)) !== null) {
            finalSegments.push(afterOpenQuotes.slice(lastIndex, closeMatch.index));
            finalSegments.push('»');
            replacedCount++;
            lastIndex = closeRegex.lastIndex;
        }
        
        finalSegments.push(afterOpenQuotes.slice(lastIndex));
        
        return {
            content: finalSegments.join(''),
            replacedCount: replacedCount
        };
    }
    
    calculateNewCursorPosition(originalCursor, originalContent, newContent) {
        try {
            const doc = this.getMockDoc(originalContent);
            const originalIndex = doc.indexFromPos(originalCursor);
            
            let newIndex = originalIndex;
            
            const textBeforeCursor = originalContent.substring(0, originalIndex);
            const openQuotesBefore = (textBeforeCursor.match(/<</g) || []).length;
            const closeQuotesBefore = (textBeforeCursor.match(/>>/g) || []).length;
            
            newIndex -= (openQuotesBefore + closeQuotesBefore);
            
            const newDoc = this.getMockDoc(newContent);
            return newDoc.posFromIndex(Math.max(0, newIndex));
            
        } catch (e) {
            console.error('Error calculating cursor position:', e);
            return originalCursor;
        }
    }
    
    calculateNewSelections(originalSelections, originalContent, newContent) {
        return originalSelections.map(selection => ({
            anchor: this.calculateNewCursorPosition(selection.anchor, originalContent, newContent),
            head: this.calculateNewCursorPosition(selection.head, originalContent, newContent)
        }));
    }
    
    getMockDoc(content) {
        const lines = content.split('\n');
        return {
            indexFromPos: (pos) => {
                let index = 0;
                for (let i = 0; i < pos.line; i++) {
                    index += lines[i].length + 1; // +1 для \n
                }
                index += pos.ch;
                return index;
            },
            posFromIndex: (index) => {
                let line = 0;
                let ch = index;
                
                for (let i = 0; i < lines.length; i++) {
                    const lineLength = lines[i].length + 1;
                    if (ch < lineLength) {
                        return { line: i, ch: Math.min(ch, lines[i].length) };
                    }
                    ch -= lineLength;
                    line++;
                }
                
                return { line: lines.length - 1, ch: lines[lines.length - 1].length };
            }
        };
    }
    
    applyChangesAsTransaction(doc, originalContent, newContent) {
        if (originalContent !== newContent) {
            doc.replaceRange(newContent, { line: 0, ch: 0 }, { 
                line: doc.lineCount() - 1, 
                ch: doc.getLine(doc.lineCount() - 1).length 
            });
        }
    }
    
    restoreEditorState(doc, newCursor, newSelections, scrollInfo, cm) {
        try {
            if (newSelections && newSelections.length > 0) {
                doc.setSelections(newSelections);
            } else {
                doc.setCursor(newCursor);
            }
            
            cm.scrollTo(scrollInfo.left, scrollInfo.top);
        } catch (e) {
            console.error('Error restoring editor state:', e);
            doc.setCursor({ line: 0, ch: 0 });
        }
    }
    
    highlightFrenchQuotes(cm) {
        this.removeHighlights();
        
        if (this.highlightTimeout) {
            clearTimeout(this.highlightTimeout);
        }
        
        this.highlightMarks = [];
        const content = cm.getValue();
        const doc = cm.getDoc();
        
        const quoteRegex = /[«»]/g;
        let match;
        
        while ((match = quoteRegex.exec(content)) !== null) {
            try {
                const fromPos = cm.posFromIndex(match.index);
                const toPos = cm.posFromIndex(match.index + 1);
                
                const mark = doc.markText(fromPos, toPos, {
                    className: 'quote-highlight',
                    inclusiveLeft: false,
                    inclusiveRight: false
                });
                
                this.highlightMarks.push(mark);
            } catch (e) {
                console.error('Error highlighting quote:', e);
            }
        }
        
        this.highlightTimeout = setTimeout(() => {
            this.removeHighlights();
        }, 2000);
    }
    
    removeHighlights() {
        if (this.highlightMarks && this.highlightMarks.length > 0) {
            this.highlightMarks.forEach(mark => {
                try {
                    mark.clear();
                } catch (e) {
                }
            });
            this.highlightMarks = [];
        }
    }
    
    replaceInEditor(editor) {
        const view = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
        if (!view) return;
        
        const doc = editor.getDoc();
        const originalContent = doc.getValue();
        const originalCursor = doc.getCursor();
        const originalSelections = doc.listSelections();
        const scrollInfo = editor.getScrollInfo();
        
        const result = this.replaceQuotes(originalContent);
        
        if (result.replacedCount > 0) {
            const newCursor = this.calculateNewCursorPosition(originalCursor, originalContent, result.content);
            const newSelections = this.calculateNewSelections(originalSelections, originalContent, result.content);
            
            this.applyChangesAsTransaction(doc, originalContent, result.content);
            
            this.restoreEditorState(doc, newCursor, newSelections, scrollInfo, editor);
            
            this.highlightFrenchQuotes(editor);
            
            this.showNotification(result.replacedCount);
        } else {
            new Notice('Кавычки для замены не найдены', 3000);
        }
    }
    
    onunload() {
        if (this.highlightTimeout) {
            clearTimeout(this.highlightTimeout);
        }
        
        const style = document.getElementById('auto-quotes-highlight');
        if (style) style.remove();
        
        this.removeHighlights();
        
        console.log('Auto Quotes Replacer unloaded');
    }
}
