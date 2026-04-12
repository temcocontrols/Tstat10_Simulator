/**
 * Tstat10 Mock Bridge
 * Mimics T3000 C++ ExecuteScriptAsync calls
 */

const Tstat10_Data = {
    stp: 22.0,
    temp: 22.4,
    hum: 45,
    modbus: 133,
    baud: 115200,
    fan: 'AUTO',
    sys: 'AUTO'
};

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// Function T3000 will call: updateUI({temp: 24.1, stp: 16.0})
window.updateUI = function(data) {
    if (data.temp !== undefined) {
        Tstat10_Data.temp = typeof data.temp === 'number' ? data.temp : parseFloat(data.temp);
        setText('temp_val', data.temp);
    }
    if (data.stp !== undefined) {
        const num = typeof data.stp === 'number' ? data.stp : parseFloat(String(data.stp).replace(',', '.'));
        Tstat10_Data.stp = num;
        setText('stp_val', Number.isFinite(num) ? num.toFixed(2) : String(data.stp));
    }
    if (data.hum !== undefined) setText('hum_val', data.hum);
    if (data.modbus !== undefined) setText('modbus_id', data.modbus);
    if (data.fan !== undefined) {
        Tstat10_Data.fan = data.fan;
        setText('fan_val', data.fan);
    }
    if (data.sys !== undefined) {
        Tstat10_Data.sys = data.sys;
        setText('sys_val', data.sys);
    }

    console.log('UI Updated from Host:', data);
};

window.Tstat10_Data = Tstat10_Data;

// Prototype Tool: Press 'D' to toggle "Random Drift"
let driftInterval = null;
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd') {
        if (driftInterval) {
            clearInterval(driftInterval);
            driftInterval = null;
            console.log('Drift Disabled');
        } else {
            driftInterval = setInterval(() => {
                Tstat10_Data.temp = (parseFloat(Tstat10_Data.temp) + (Math.random() * 0.4 - 0.2)).toFixed(1);
                window.updateUI({ temp: Tstat10_Data.temp });
            }, 2000);
            console.log('Drift Enabled');
        }
    }
});
