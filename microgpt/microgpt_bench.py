"""
microgpt with latency benchmarking.
Runs the original Karpathy microgpt and measures:
  - Per-step training time
  - Forward pass latency
  - Backward pass latency
  - Inference latency per token
"""

import os
import math
import random
import time

random.seed(42)

# --- Dataset ---
if not os.path.exists('input.txt'):
    import urllib.request
    names_url = 'https://raw.githubusercontent.com/karpathy/makemore/988aa59/names.txt'
    urllib.request.urlretrieve(names_url, 'input.txt')

docs = [line.strip() for line in open('input.txt') if line.strip()]
random.shuffle(docs)
print(f"num docs: {len(docs)}")

# --- Tokenizer ---
uchars = sorted(set(''.join(docs)))
BOS = len(uchars)
vocab_size = len(uchars) + 1
print(f"vocab size: {vocab_size}")

# --- Autograd ---
class Value:
    __slots__ = ('data', 'grad', '_children', '_local_grads')

    def __init__(self, data, children=(), local_grads=()):
        self.data = data
        self.grad = 0
        self._children = children
        self._local_grads = local_grads

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return Value(self.data + other.data, (self, other), (1, 1))

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return Value(self.data * other.data, (self, other), (other.data, self.data))

    def __pow__(self, other): return Value(self.data**other, (self,), (other * self.data**(other-1),))
    def log(self): return Value(math.log(self.data), (self,), (1/self.data,))
    def exp(self): return Value(math.exp(self.data), (self,), (math.exp(self.data),))
    def relu(self): return Value(max(0, self.data), (self,), (float(self.data > 0),))
    def __neg__(self): return self * -1
    def __radd__(self, other): return self + other
    def __sub__(self, other): return self + (-other)
    def __rsub__(self, other): return other + (-self)
    def __rmul__(self, other): return self * other
    def __truediv__(self, other): return self * other**-1
    def __rtruediv__(self, other): return other * self**-1

    def backward(self):
        topo = []
        visited = set()
        def build_topo(v):
            if v not in visited:
                visited.add(v)
                for child in v._children:
                    build_topo(child)
                topo.append(v)
        build_topo(self)
        self.grad = 1
        for v in reversed(topo):
            for child, local_grad in zip(v._children, v._local_grads):
                child.grad += local_grad * v.grad

# --- Model params ---
n_layer = 1
n_embd = 16
block_size = 16
n_head = 4
head_dim = n_embd // n_head

matrix = lambda nout, nin, std=0.08: [[Value(random.gauss(0, std)) for _ in range(nin)] for _ in range(nout)]

state_dict = {'wte': matrix(vocab_size, n_embd), 'wpe': matrix(block_size, n_embd), 'lm_head': matrix(vocab_size, n_embd)}

for i in range(n_layer):
    state_dict[f'layer{i}.attn_wq'] = matrix(n_embd, n_embd)
    state_dict[f'layer{i}.attn_wk'] = matrix(n_embd, n_embd)
    state_dict[f'layer{i}.attn_wv'] = matrix(n_embd, n_embd)
    state_dict[f'layer{i}.attn_wo'] = matrix(n_embd, n_embd)
    state_dict[f'layer{i}.mlp_fc1'] = matrix(4 * n_embd, n_embd)
    state_dict[f'layer{i}.mlp_fc2'] = matrix(n_embd, 4 * n_embd)

params = [p for mat in state_dict.values() for row in mat for p in row]
print(f"num params: {len(params)}")

# --- Model forward ---
def linear(x, w):
    return [sum(wi * xi for wi, xi in zip(wo, x)) for wo in w]

def softmax(logits):
    max_val = max(val.data for val in logits)
    exps = [(val - max_val).exp() for val in logits]
    total = sum(exps)
    return [e / total for e in exps]

def rmsnorm(x):
    ms = sum(xi * xi for xi in x) / len(x)
    scale = (ms + 1e-5) ** -0.5
    return [xi * scale for xi in x]

def gpt(token_id, pos_id, keys, values):
    tok_emb = state_dict['wte'][token_id]
    pos_emb = state_dict['wpe'][pos_id]
    x = [t + p for t, p in zip(tok_emb, pos_emb)]
    x = rmsnorm(x)

    for li in range(n_layer):
        x_residual = x
        x = rmsnorm(x)
        q = linear(x, state_dict[f'layer{li}.attn_wq'])
        k = linear(x, state_dict[f'layer{li}.attn_wk'])
        v = linear(x, state_dict[f'layer{li}.attn_wv'])
        keys[li].append(k)
        values[li].append(v)

        x_attn = []
        for h in range(n_head):
            hs = h * head_dim
            q_h = q[hs:hs+head_dim]
            k_h = [ki[hs:hs+head_dim] for ki in keys[li]]
            v_h = [vi[hs:hs+head_dim] for vi in values[li]]
            attn_logits = [sum(q_h[j] * k_h[t][j] for j in range(head_dim)) / head_dim**0.5 for t in range(len(k_h))]
            attn_weights = softmax(attn_logits)
            head_out = [sum(attn_weights[t] * v_h[t][j] for t in range(len(v_h))) for j in range(head_dim)]
            x_attn.extend(head_out)

        x = linear(x_attn, state_dict[f'layer{li}.attn_wo'])
        x = [a + b for a, b in zip(x, x_residual)]

        x_residual = x
        x = rmsnorm(x)
        x = linear(x, state_dict[f'layer{li}.mlp_fc1'])
        x = [xi.relu() for xi in x]
        x = linear(x, state_dict[f'layer{li}.mlp_fc2'])
        x = [a + b for a, b in zip(x, x_residual)]

    logits = linear(x, state_dict['lm_head'])
    return logits

# --- Adam optimizer ---
learning_rate, beta1, beta2, eps_adam = 0.01, 0.85, 0.99, 1e-8
m_buf = [0.0] * len(params)
v_buf = [0.0] * len(params)

# --- Training with benchmarking ---
num_steps = 50  # reduced for benchmarking (original: 1000)
fwd_times = []
bwd_times = []
step_times = []

print(f"\n=== TRAINING ({num_steps} steps) ===")
train_start = time.perf_counter()

for step in range(num_steps):
    step_start = time.perf_counter()

    doc = docs[step % len(docs)]
    tokens = [BOS] + [uchars.index(ch) for ch in doc] + [BOS]
    n = min(block_size, len(tokens) - 1)

    # Forward pass
    fwd_start = time.perf_counter()
    keys, values = [[] for _ in range(n_layer)], [[] for _ in range(n_layer)]
    losses = []
    for pos_id in range(n):
        token_id, target_id = tokens[pos_id], tokens[pos_id + 1]
        logits = gpt(token_id, pos_id, keys, values)
        probs = softmax(logits)
        loss_t = -probs[target_id].log()
        losses.append(loss_t)
    loss = (1 / n) * sum(losses)
    fwd_end = time.perf_counter()
    fwd_times.append(fwd_end - fwd_start)

    # Backward pass
    bwd_start = time.perf_counter()
    loss.backward()
    bwd_end = time.perf_counter()
    bwd_times.append(bwd_end - bwd_start)

    # Optimizer step
    lr_t = learning_rate * (1 - step / num_steps)
    for i, p in enumerate(params):
        m_buf[i] = beta1 * m_buf[i] + (1 - beta1) * p.grad
        v_buf[i] = beta2 * v_buf[i] + (1 - beta2) * p.grad ** 2
        m_hat = m_buf[i] / (1 - beta1 ** (step + 1))
        v_hat = v_buf[i] / (1 - beta2 ** (step + 1))
        p.data -= lr_t * m_hat / (v_hat ** 0.5 + eps_adam)
        p.grad = 0

    step_end = time.perf_counter()
    step_times.append(step_end - step_start)

    if (step + 1) % 10 == 0 or step == 0:
        print(f"step {step+1:4d}/{num_steps} | loss {loss.data:.4f} | fwd {fwd_times[-1]*1000:.1f}ms | bwd {bwd_times[-1]*1000:.1f}ms | total {step_times[-1]*1000:.1f}ms")

train_elapsed = time.perf_counter() - train_start

# --- Training summary ---
print(f"\n=== TRAINING LATENCY SUMMARY ({num_steps} steps) ===")
print(f"Total training time:    {train_elapsed:.2f}s")
print(f"Avg step time:          {sum(step_times)/len(step_times)*1000:.1f}ms")
print(f"Avg forward pass:       {sum(fwd_times)/len(fwd_times)*1000:.1f}ms")
print(f"Avg backward pass:      {sum(bwd_times)/len(bwd_times)*1000:.1f}ms")
print(f"Avg optimizer step:     {(sum(step_times)-sum(fwd_times)-sum(bwd_times))/len(step_times)*1000:.1f}ms")
print(f"Min/Max step time:      {min(step_times)*1000:.1f}ms / {max(step_times)*1000:.1f}ms")

# --- Inference with benchmarking ---
temperature = 0.5
num_samples = 10

print(f"\n=== INFERENCE ({num_samples} samples) ===")
inference_times = []
token_times = []

for sample_idx in range(num_samples):
    inf_start = time.perf_counter()
    keys, values = [[] for _ in range(n_layer)], [[] for _ in range(n_layer)]
    token_id = BOS
    sample = []
    sample_token_times = []

    for pos_id in range(block_size):
        tok_start = time.perf_counter()
        logits = gpt(token_id, pos_id, keys, values)
        probs = softmax([l / temperature for l in logits])
        token_id = random.choices(range(vocab_size), weights=[p.data for p in probs])[0]
        tok_end = time.perf_counter()
        sample_token_times.append(tok_end - tok_start)

        if token_id == BOS:
            break
        sample.append(uchars[token_id])

    inf_end = time.perf_counter()
    inference_times.append(inf_end - inf_start)
    token_times.extend(sample_token_times)

    name = ''.join(sample)
    n_tok = len(sample_token_times)
    avg_tok = sum(sample_token_times)/n_tok*1000
    print(f"sample {sample_idx+1:2d}: {name:<16s} | {n_tok} tokens | {(inf_end-inf_start)*1000:.1f}ms total | {avg_tok:.1f}ms/token")

# --- Inference summary ---
print(f"\n=== INFERENCE LATENCY SUMMARY ===")
print(f"Avg sample time:        {sum(inference_times)/len(inference_times)*1000:.1f}ms")
print(f"Avg per-token latency:  {sum(token_times)/len(token_times)*1000:.1f}ms")
print(f"Min/Max token latency:  {min(token_times)*1000:.1f}ms / {max(token_times)*1000:.1f}ms")
print(f"Total inference time:   {sum(inference_times):.2f}s")

# --- Overall ---
print(f"\n=== ENVIRONMENT ===")
import sys
print(f"Python: {sys.version}")
import platform
print(f"Platform: {platform.platform()}")
print(f"CPU: {platform.processor() or 'unknown'}")
