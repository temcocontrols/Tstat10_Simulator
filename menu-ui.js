// menu-ui.js: Handles rendering of menu header, rows, arrows for LCD simulator

// Render the menu header
export function renderMenuHeader(lcd, data) {
    const headerData = data.widgets[0];
    const header = document.createElement('div');
    header.style.textAlign = 'center';
    header.style.fontWeight = 'bold';
    header.style.fontWeight = data.styles?.fontWeight || 'bold';
    header.style.fontSize = data.styles?.fontSize || headerData.fontSize || '22px';
    header.style.marginTop = '36px';
    header.style.marginBottom = '32px';
    header.innerHTML = headerData.text.replace(/\n/g, '<br>');
    lcd.appendChild(header);
}

// Render menu rows
export function renderMenuRows(lcd, data, menuRowsFocusedIndex) {
    const menuRowsData = data.widgets.filter(w => w.type === 'menu_row').map(row => {
        if (Array.isArray(row.options) && row.options.every(v => typeof v === 'number')) {
            row = { ...row, options: [...row.options].sort((a, b) => a - b) };
        }
        return row;
    });
    const textWidth = data.styles?.textWidthChars || 6;
    const valueBoxWidth = data.styles?.valueBoxWidthChars || 8;
    const baseFontSize = parseInt((data.styles?.fontSize || '22px').replace('px',''), 10) + 3;
    menuRowsData.forEach((widget, idx) => {
        // Always get the current value from the global data (window._networkSettingsData)
        let liveWidget = (window._networkSettingsData?.widgets || []).find(w => w.type === 'menu_row' && w.id === widget.id) || widget;
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.margin = '6px 0 6px 0';
        row.style.padding = '6px 0';
        row.style.borderRadius = '8px';
        row.style.background = (idx === menuRowsFocusedIndex) ? (data.styles?.highlight || '#008080') : 'rgba(0,0,0,0.08)';
        row.style.fontSize = baseFontSize + 'px';
        row.style.fontFamily = data.styles?.fontFamily || 'Segoe UI, Arial, sans-serif';
        row.style.fontWeight = data.styles?.fontWeight || 'bold';
        row.style.fontFamily = data.styles?.fontFamily || 'monospace';
        row.style.gap = '0';
        row.style.padding = '0';
        row.style.margin = '0';
        // Label
        const labelSpan = document.createElement('span');
        let labelText = (widget.label + ' '.repeat(textWidth)).slice(0, textWidth);
        if (idx === menuRowsFocusedIndex) {
            labelSpan.style.background = data.styles?.highlight || '#008080';
            labelSpan.style.borderRadius = '8px';
        }
        labelSpan.textContent = labelText;
        labelSpan.style.display = 'inline-block';
        labelSpan.style.width = textWidth + 'ch';
        labelSpan.style.minWidth = textWidth + 'ch';
        labelSpan.style.maxWidth = textWidth + 'ch';
        labelSpan.style.textAlign = 'left';
        labelSpan.style.fontWeight = 'bold';
        labelSpan.style.color = '#fff';
        labelSpan.style.padding = '0';
        labelSpan.style.margin = '0';
        labelSpan.style.fontWeight = data.styles?.fontWeight || 'bold';
        labelSpan.style.fontFamily = data.styles?.fontFamily || 'monospace';
        labelSpan.style.fontSize = baseFontSize + 'px';
        // Value
        const valueSpan = document.createElement('span');
        valueSpan.textContent = (liveWidget.value ?? '').toString().padEnd(valueBoxWidth, ' ');
        valueSpan.style.display = 'inline-block';
        valueSpan.style.background = '#fff';
        valueSpan.style.color = '#003366';
        valueSpan.style.fontWeight = 'bold';
        valueSpan.style.borderRadius = '8px';
        valueSpan.style.width = valueBoxWidth + 'ch';
        valueSpan.style.minWidth = valueBoxWidth + 'ch';
        valueSpan.style.maxWidth = valueBoxWidth + 'ch';
        valueSpan.style.padding = '0';
        valueSpan.style.fontWeight = data.styles?.fontWeight || 'bold';
        valueSpan.style.textAlign = 'center';
        valueSpan.style.boxShadow = (idx === menuRowsFocusedIndex) ? '0 2px 8px rgba(0,120,215,0.18)' : 'none';
        valueSpan.style.fontFamily = data.styles?.fontFamily || 'monospace';
        valueSpan.style.fontSize = baseFontSize + 'px';
        valueSpan.style.margin = '0';
        row.appendChild(labelSpan);
        row.appendChild(valueSpan);
        lcd.appendChild(row);
    });
}

// Render the arrow key row at the bottom
export function renderArrowRow(lcd, data) {
    const arrowRow = document.createElement('div');
    arrowRow.style.position = 'absolute';
    arrowRow.style.left = '0';
    arrowRow.style.bottom = '0';
    arrowRow.style.height = '1em';
    arrowRow.style.width = '100%';
    arrowRow.style.fontSize = '28px';
    arrowRow.style.lineHeight = '1em';
    arrowRow.style.fontFamily = data.styles?.fontFamily || 'monospace';
    arrowRow.style.pointerEvents = 'none';
    const arrowPositions = [2, 6, 10, 16];
    const arrows = [
        { id: 'arrow-left',  char: '◀',  style: 'font-weight: normal;' },
        { id: 'arrow-down',  char: '▼',  style: 'font-weight: bold; font-size: 36px; line-height: 1;' },
        { id: 'arrow-up',    char: '▲',  style: 'font-weight: bold; font-size: 36px; line-height: 1;' },
        { id: 'arrow-right', char: '▶',  style: 'font-weight: normal;' }
    ];
    let arrowHtml = '';
    for (let i = 0; i < arrows.length; i++) {
        let left = arrowPositions[i];
        if (i === 1) left -= 0.5;
        arrowHtml += `<span id="${arrows[i].id}" style="position: absolute; left: ${left}ch; bottom: 0.15em; padding-bottom: 0.1em; ${arrows[i].style} pointer-events: none;">${arrows[i].char}</span>`;
    }
    arrowRow.innerHTML = arrowHtml;
    lcd.appendChild(arrowRow);
}

// Render a dead (blank) row after the arrow row
export function renderDeadRow(lcd) {
    const deadRow = document.createElement('div');
    deadRow.style.height = '1em';
    deadRow.style.width = '100%';
    deadRow.style.background = 'transparent';
    deadRow.style.pointerEvents = 'none';
    lcd.appendChild(deadRow);
}