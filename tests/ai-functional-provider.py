"""Standalone HTTP/SSE supplier boundary; records only synthetic requests."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib, importlib.util, json, socket, threading, time
from ai_functional_environment import OUT,SOURCE,network_guard
network_guard()
lock=threading.Lock()

def log(value):
    with lock:
        with (OUT/'provider-requests.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(value,ensure_ascii=False)+'\n')

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
        body=json.loads(raw)
        model=body.get('model','');stream=body.get('stream',False)
        log({'at':time.time(),'path':self.path,'model':model,'stream':stream,'bodySha256':hashlib.sha256(raw).hexdigest(),'body':body})
        if model=='isofunc-chat-delay':time.sleep(4)
        if model=='isofunc-chat-drop':
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length','9999');self.end_headers()
            self.wfile.write(b'{"id":"lost-');self.wfile.flush();self.close_connection=True
            self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
        status=200
        message={'role':'assistant','content':'隔离HTTP供应商回复：普通问题已回答。'}
        response={'id':'fixture-http','object':'chat.completion','choices':[{'index':0,'message':message,'finish_reason':'stop'}],'usage':{'prompt_tokens':40,'completion_tokens':16,'total_tokens':56}}
        if model=='isofunc-chat-429':status,response=429,{'error':{'type':'rate_limit_error','message':'synthetic quota rejection'}}
        report_file=SOURCE/'tests/ai-functional-reports-fixture.py'
        if model.startswith('isofunc-report-') and report_file.exists():
            spec=importlib.util.spec_from_file_location('report_fixture',report_file)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            answered=module.respond(body)
            if answered:status,response=answered
        runner_file=SOURCE/'tests/ai-functional-runners-fixture.py'
        if model.startswith('isofunc-pi-') and runner_file.exists():
            spec=importlib.util.spec_from_file_location('runner_fixture',runner_file)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            answered=module.respond(body)
            if answered:status,response=answered
        if stream and status==200:
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
            for piece in ['隔离','流式','回复']:
                chunk={'id':'fixture-stream','object':'chat.completion.chunk','choices':[{'index':0,'delta':{'content':piece},'finish_reason':None}]}
                self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode());self.wfile.flush();time.sleep(.15)
            self.wfile.write(b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');self.wfile.flush();self.close_connection=True;return
        data=json.dumps(response,ensure_ascii=False).encode()
        try:
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass

ThreadingHTTPServer(('127.0.0.1',28446),Handler).serve_forever()
