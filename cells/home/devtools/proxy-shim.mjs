// Route serve.mjs's outbound fetch through the sandbox's HTTPS proxy (node
// fetch ignores proxy env vars; undici's EnvHttpProxyAgent honours them and
// the CA bundle via NODE_EXTRA_CA_CERTS).
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';
setGlobalDispatcher(new EnvHttpProxyAgent());
