import os
import subprocess

def run_cmd(cmd):
    subprocess.run(cmd, shell=True, check=True)

# 1. Install Miniconda locally in Kaggle to force Python 3.10
print("Installing Python 3.10 Sandbox (Miniconda)...")
run_cmd("wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh")
run_cmd("bash Miniconda3-latest-Linux-x86_64.sh -b -p /kaggle/working/miniconda")

conda_bin = "/kaggle/working/miniconda/bin/conda"
pip_bin = "/kaggle/working/miniconda/envs/aiedge/bin/pip"
python_bin = "/kaggle/working/miniconda/envs/aiedge/bin/python"

# 2. Create Python 3.10 environment
print("Creating environment...")
run_cmd(f"{conda_bin} create -n aiedge python=3.10 -y")

# 3. Install requirements
print("Installing dependencies...")
run_cmd(f"{pip_bin} install -q ai-edge-torch-nightly mediapipe transformers huggingface_hub torch")

# 4. HuggingFace Login (REPLACE YOUR TOKEN HERE)
token = "hf_YOUR_TOKEN_HERE" 
run_cmd(f"{python_bin} -c \"from huggingface_hub import login; login('{token}')\"")

# 5. Clone and Convert
print("Cloning repo and compiling Llama 3.2 1B (takes ~10 mins)...")
if not os.path.exists("/kaggle/working/ai-edge-torch"):
    run_cmd("git clone https://github.com/google-ai-edge/ai-edge-torch.git /kaggle/working/ai-edge-torch")

os.chdir("/kaggle/working/ai-edge-torch")
run_cmd(f"{python_bin} -m ai_edge_torch.generative.examples.llama.convert_to_tflite --checkpoint_path='meta-llama/Llama-3.2-1B-Instruct' --quantization='dynamic_int8' --output_path='llama3_2_1b.tflite'")

# 6. Bundle Script
bundler_script = """
import mediapipe as mp
from mediapipe.tasks.python.genai import bundler
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained('meta-llama/Llama-3.2-1B-Instruct')
tokenizer.save_pretrained('./tokenizer_out')

config = bundler.BundleConfig(
    tflite_model='llama3_2_1b.tflite',
    tokenizer_model='./tokenizer_out/tokenizer.model',
    start_token='<|begin_of_text|>',
    stop_tokens=['<|end_of_text|>', '<|eot_id|>'],
    output_filename='llama-3.2-1b-instruct-int8.task',
    enable_bytes_to_unicode_mapping=True,
)
bundler.create_bundle(config)
print('✅ SUCCESS! File created: llama-3.2-1b-instruct-int8.task')
"""
with open("bundle.py", "w") as f:
    f.write(bundler_script)

print("Bundling MediaPipe Task file...")
run_cmd(f"{python_bin} bundle.py")
