import asyncio
import base64
import json
import os
import sys
import pyaudio
from websockets.asyncio.client import connect
from termcolor import colored

# Python 3.11 以下版本兼容
if sys.version_info < (3, 11, 0):
    import taskgroup, exceptiongroup
    asyncio.TaskGroup = taskgroup.TaskGroup
    asyncio.ExceptionGroup = exceptiongroup.ExceptionGroup

# 音频配置
FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 2048  # 较大的缓冲区大小

# API 配置
HOST = 'generativelanguage.googleapis.com'
MODEL = "gemini-2.0-flash-exp"
API_KEY = "AIzaSyDX-jQAZCAyMWfA0YfIE-ukbKSdclXHD0o"
if not API_KEY:
    raise ValueError(colored("Error: GEMINI_API_KEY not found", "red"))

URI = f"wss://{HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={API_KEY}"

class GeminiVoiceChat:
    def __init__(self):
        self.audio_in_queue = asyncio.Queue()
        self.audio_out_queue = asyncio.Queue()
        self.ws = None
        self.running = True
        self.is_speaking = False
        self.conversation_context = []
        
    async def startup(self):
        """初始化连接和设置"""
        setup_msg = {"setup": {"model": f"models/{MODEL}"}}
        await self.ws.send(json.dumps(setup_msg))
        await self.ws.recv(decode=False)
        print(colored("系统初始化完成", "green"))

    async def listen_audio(self):
        """监听音频输入"""
        pya = pyaudio.PyAudio()
        try:
            mic_info = pya.get_default_input_device_info()
            print(colored(f"使用输入设备: {mic_info['name']}", "green"))
            
            stream = pya.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=SEND_SAMPLE_RATE,
                input=True,
                input_device_index=mic_info["index"],
                frames_per_buffer=CHUNK_SIZE,
            )
            print(colored("音频输入流已打开", "green"))
            
            while self.running:
                try:
                    data = await asyncio.to_thread(stream.read, CHUNK_SIZE, exception_on_overflow=False)
                    if not self.is_speaking:  # 只在AI不说话时发送音频
                        await self.audio_out_queue.put(data)
                        print(colored(".", "green", attrs=["bold"]), end="", flush=True)
                    await asyncio.sleep(0.01)
                except OSError as e:
                    if e.errno == -9981:  # Input overflow
                        await asyncio.sleep(0.1)
                        continue
                    else:
                        raise
                except Exception as e:
                    print(colored(f"\n音频输入错误: {str(e)}", "yellow"))
                    await asyncio.sleep(0.1)
                    continue
                    
        except Exception as e:
            print(colored(f"\n严重的音频输入错误: {str(e)}", "red"))
            self.running = False
        finally:
            stream.stop_stream()
            stream.close()
            pya.terminate()

    async def send_audio(self):
        """发送音频数据"""
        while self.running:
            try:
                chunk = await self.audio_out_queue.get()
                if chunk and not self.is_speaking:
                    msg = {
                        "realtime_input": {
                            "media_chunks": [
                                {"data": base64.b64encode(chunk).decode(), "mime_type": "audio/pcm"}
                            ]
                        }
                    }
                    await self.ws.send(json.dumps(msg))
            except Exception as e:
                print(colored(f"\n发送音频错误: {str(e)}", "yellow"))
                await asyncio.sleep(0.1)

    async def receive_response(self):
        """接收和处理响应"""
        accumulated_audio = b""
        try:
            async for msg in self.ws:
                if not self.running:
                    break
                    
                response = json.loads(msg)
                
                try:
                    if "serverContent" in response:
                        self.is_speaking = True
                        audio_data = response["serverContent"]["modelTurn"]["parts"][0]["inlineData"]["data"]
                        decoded_audio = base64.b64decode(audio_data)
                        accumulated_audio += decoded_audio
                        
                        # 当累积足够的音频数据时才发送到播放队列
                        if len(accumulated_audio) >= CHUNK_SIZE:
                            await self.audio_in_queue.put(accumulated_audio)
                            accumulated_audio = b""
                            print(colored("*", "yellow", attrs=["bold"]), end="", flush=True)
                except KeyError:
                    pass

                if "serverContent" in response and response["serverContent"].get("turnComplete"):
                    # 发送剩余的音频数据
                    if accumulated_audio:
                        await self.audio_in_queue.put(accumulated_audio)
                    print(colored("\n回应完成", "cyan"))
                    self.is_speaking = False
                    
        except Exception as e:
            print(colored(f"\n接收响应错误: {str(e)}", "red"))
            self.running = False

    async def play_audio(self):
        """播放音频"""
        pya = pyaudio.PyAudio()
        try:
            output_info = pya.get_default_output_device_info()
            print(colored(f"使用输出设备: {output_info['name']}", "green"))
            
            stream = pya.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=RECEIVE_SAMPLE_RATE,
                output=True,
                frames_per_buffer=CHUNK_SIZE
            )
            
            while self.running:
                try:
                    audio_data = await self.audio_in_queue.get()
                    if audio_data:
                        await asyncio.to_thread(stream.write, audio_data)
                except Exception as e:
                    print(colored(f"\n播放错误: {str(e)}", "yellow"))
                    await asyncio.sleep(0.1)
                    continue
                    
        except Exception as e:
            print(colored(f"\n严重的播放错误: {str(e)}", "red"))
            self.running = False
        finally:
            stream.stop_stream()
            stream.close()
            pya.terminate()

    async def run(self):
        """主运行循环"""
        try:
            print(colored("正在连接到 Gemini...", "yellow"))
            async with await connect(
                URI, additional_headers={"Content-Type": "application/json"}
            ) as ws:
                self.ws = ws
                await self.startup()
                print(colored("已连接到 Gemini。开始语音对话...", "green"))
                print(colored("提示: 开始说话，系统会自动识别并回应。等待系统回应完成后再继续说话。", "cyan"))

                async with asyncio.TaskGroup() as tg:
                    tasks = [
                        tg.create_task(self.listen_audio()),
                        tg.create_task(self.send_audio()),
                        tg.create_task(self.receive_response()),
                        tg.create_task(self.play_audio()),
                    ]
                    
                    try:
                        await asyncio.gather(*tasks)
                    except* Exception as e:
                        print(colored(f"\n主循环错误: {str(e)}", "red"))
                    finally:
                        self.running = False
                        for task in tasks:
                            if not task.done():
                                task.cancel()
                
        except Exception as e:
            print(colored(f"连接错误: {str(e)}", "red"))
        finally:
            self.running = False

def main():
    try:
        print(colored("\n启动 Gemini 语音聊天", "cyan"))
        print(colored("按 Ctrl+C 可以退出程序", "yellow"))
        client = GeminiVoiceChat()
        asyncio.run(client.run())
    except KeyboardInterrupt:
        print(colored("\n程序已被用户终止", "yellow"))
    except Exception as e:
        print(colored(f"严重错误: {str(e)}", "red"))
    finally:
        print(colored("\n正在清理资源...", "yellow"))

if __name__ == "__main__":
    main()