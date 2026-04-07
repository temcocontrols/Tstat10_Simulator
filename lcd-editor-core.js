export function ensureCanonicalSchema(data) {
    if (!data || typeof data !== 'object') return data;

    data.schemaVersion = data.schemaVersion || '1.0.0';
    data.canvasProfile = data.canvasProfile || {};
    data.colorProfile = data.colorProfile || {};
    data.compatibility = data.compatibility || {};

    const legacyCanvas =
        data.layout?.canvas ||
        data.layout?.lcdCanvas ||
        {};

    const width = Number(data.canvasProfile.width || legacyCanvas.width || 320);
    const height = Number(data.canvasProfile.height || legacyCanvas.height || 480);
    const orientation = data.canvasProfile.orientation || (height >= width ? 'vertical' : 'horizontal');

    data.canvasProfile.width = width;
    data.canvasProfile.height = height;
    data.canvasProfile.orientation = orientation;

    data.colorProfile.mode = data.colorProfile.mode || 'indexed';
    data.colorProfile.themeTokens = data.colorProfile.themeTokens || {
        bg: data.styles?.bg || '#2c7cc4',
        text: '#ffffff',
        accent: data.styles?.highlight || '#008080'
    };

    data.layout = data.layout || {};
    data.layout.canvas = { width, height };
    data.layout.lcdCanvas = { width, height };
    data.layout.orientation = orientation;

    data.compatibility.targets = Array.isArray(data.compatibility.targets)
        ? data.compatibility.targets
        : ['tstat10'];

    return data;
}

export function validateLayoutData(data) {
    const errors = [];
    const warnings = [];

    const width = Number(data?.canvasProfile?.width || 0);
    const height = Number(data?.canvasProfile?.height || 0);
    const orientation = data?.canvasProfile?.orientation;
    const mode = data?.colorProfile?.mode;
    const widgets = Array.isArray(data?.widgets) ? data.widgets : [];

    if (!Number.isInteger(width) || width <= 0) errors.push('Canvas width must be a positive integer.');
    if (!Number.isInteger(height) || height <= 0) errors.push('Canvas height must be a positive integer.');
    if (orientation !== 'vertical' && orientation !== 'horizontal') {
        errors.push('Orientation must be vertical or horizontal.');
    }

    if (!['indexed', 'reduced_rgb'].includes(mode)) {
        errors.push('Color mode must be indexed or reduced_rgb.');
    }

    if (width * height > 250000) {
        warnings.push('Canvas area is large for Tstat10 and may not be deploy-safe.');
    }

    if (widgets.length > 80) {
        warnings.push('Widget count exceeds recommended Tstat10 phase-1 budget.');
    }

    return {
        valid: errors.length === 0,
        target: 'tstat10',
        errors,
        warnings,
        infos: []
    };
}

export function writeStatus(message, isError = false) {
    const line = document.getElementById('tstat-status-line');
    if (!line) return;
    line.textContent = message;
    line.style.background = isError ? '#6a1b1b' : '#222';
}
