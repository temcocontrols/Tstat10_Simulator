import http.server
import json
import threading
import time

modbus_id_log = []
last_modbus_id = None
last_focus = None

class DebugHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        try:
            data = json.loads(post_data)
            event = data.get('event')
            focus = data.get('focus')
            value = data.get('value')
            if focus == 'Modbus ID':
                global last_modbus_id, last_focus
                last_modbus_id = value
                last_focus = focus
                modbus_id_log.append((time.time(), value, event))
        except Exception as e:
            pass
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'OK')

def monitor_modbus_id():
    prev_value = None
    stuck_count = 0
    while True:
        time.sleep(2)
        if last_focus == 'Modbus ID':
            if last_modbus_id == prev_value:
                stuck_count += 1
            else:
                stuck_count = 0
            prev_value = last_modbus_id
            if stuck_count >= 3 and last_modbus_id == 1:
                print("[ALERT] Modbus ID is stuck at 1. Please rework the simulator logic so it increases with keypad up events.")
                stuck_count = 0

if __name__ == '__main__':
    server = http.server.HTTPServer(('localhost', 5001), DebugHandler)
    threading.Thread(target=monitor_modbus_id, daemon=True).start()
    print("Debug monitor running on http://localhost:5001/debug")
    server.serve_forever()
