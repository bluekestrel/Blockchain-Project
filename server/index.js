const express = require('express');
const cors = require('cors');
const EC = require('elliptic').ec;
const SHA256 = require('crypto-js/sha256');

const app = express();
const ec = new EC('secp256k1');
const port = 3042;
const INIT_BALANCE_LEN = 3; // arbitrarily set to 3

// localhost can have cross origin errors
// depending on the browser you use!
app.use(cors());
app.use(express.json());

function random_balance(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function generate_balances_and_keys() {
  let balances = {};
  let keys = [];
  for (let i = 0; i < INIT_BALANCE_LEN; i++) {
    // Create the public/private key pair, and generate a balance
    const new_key = ec.genKeyPair();
    const pubkey = new_key.getPublic().encode('hex').toString(16);
    const privkey = new_key.getPrivate().toString(16);
    const init_balance = random_balance(10, 100);

    balances[pubkey] = init_balance;
    keys.push({
      'publickey' : pubkey,
      'privatekey': privkey
    });
  }

  return {balances, keys};
}

function print_accounts() {
  console.log("\nAvailable Accounts\n====================");
  let i = 0;
  for (let key in balances) {
    let str_to_print = `(${i}) ${key} (${balances[key]} ETH)`;
    console.log(str_to_print);
    i++;
  }

  console.log("\nPrivate Keys\n====================");
  for (let i = 0; i < keys.length; i++) {
    let str_to_print = `(${i}) ${keys[i].privatekey}`
    console.log(str_to_print);
  }
}

function verify_account(publickey, message_hash, signature) {
  let key = null;
  try {
    key = ec.keyFromPublic(publickey, 'hex');
  }
  catch {
    return false;
  }

  try {
    return key.verify(message_hash, signature);
  }
  catch {
    return false;
  }
}

let {balances, keys} = generate_balances_and_keys();

app.get('/balance/:address', (req, res) => {
  const {address} = req.params;
  const balance = balances[address] || 0;
  res.send({ balance });
});

app.post('/send', (req, res) => {
  const {sender, recipient, amount, message_hash, sign_obj} = req.body;
  console.log(req.body);

  if (balances[sender] >= amount) {
    if (!verify_account(sender, message_hash, sign_obj['signature'])) {
      res.send({ balance: 'Public key does not match signature' });
      return;
    }

    balances[sender] -= amount;
    balances[recipient] = (balances[recipient] || 0) + +amount;
    res.send({ balance: balances[sender] });
  }
  else {
    res.send({ balance: 'Balance too low' });
  }
});

app.listen(port, () => {
  console.log(`Listening on port ${port}!`);
  print_accounts();
});
