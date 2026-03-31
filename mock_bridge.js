/**
 * Tstat10 Mock Bridge
 * Mimics T3000 C++ ExecuteScriptAsync calls
 */

const Tstat10_Data = {
    stp: 15.5,
    temp: 23.3,
    hum: 45,
    modbus: 133,
    baud: 115200
};

// Function T3000 will call: updateUI({temp: 24.1, stp: 16.0})
window.updateUI = function(data) {
    if (data.temp) document.getElementById('temp_val').innerText = data.temp;
    if (data.stp) document.getElementById('stp_val').innerText = data.stp;
    if (data.hum) document.getElementById('hum_val').innerText = data.hum;
    if (data.modbus) document.getElementById('modbus_id').innerText = data.modbus;
    
    console.log("UI Updated from Host:", data);
};

// Prototype Tool: Press 'D' to toggle "Random Drift"
let driftInterval = null;
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd') {
        if (driftInterval) {
            clearInterval(driftInterval);
            driftInterval = null;
            console.log("Drift Disabled");
        } else {
            driftInterval = setInterval(() => {
                Tstat10_Data.temp = (parseFloat(Tstat10_Data.temp) + (Math.random() * 0.4 - 0.2)).toFixed(1);
                updateUI({ temp: Tstat10_Data.temp });
            }, 2000);
            console.log("Drift Enabled");
        }
    }
});