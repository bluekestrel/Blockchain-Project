const cors = require('cors');
const EC = require('elliptic').ec;
const express = require('express');
const redis = require('redis');

const app = express();
const ec = new EC('secp256k1');
const PORT = 3042;

// Create pair of pub/sub clients so that the server-client can communicate with the blockchain miners
const clientPublisher = redis.createClient();
const clientSubscriber = redis.createClient();
const CLIENT_CHANNEL = "client-notify"

clientSubscriber.subscribe(CLIENT_CHANNEL);

// requestUpdate is a flag that lets the client keep track of whether it needs to pay attention to
// messages that come in from the CLIENT_CHANNEl
let requestedUpdate = false;
let balances = {};

// localhost can have cross origin errors
// depending on the browser you use!
app.use(cors());
app.use(express.json());

function updateBalances(blocks) {
  blocks.forEach((block) => {
    block.transactions.forEach((transaction) => {
      let {sender, recipient, amount, ...otherMetadata} = transaction;

      if (!(sender in balances) || !(recipient in balances)) {
        if (sender === recipient) {
          balances[sender] = amount;
        }
        else {
          if (!(sender in balances)) {
            balances[sender] = 0;
          }
          if (!(recipient in balances)) {
            balances[recipient] = amount;
          }
        }
      }
      else {
        if (sender === recipient) {
          balances[sender] += amount;
        }
        else {
          balances[sender] -= amount;
          balances[recipient] += amount;
        }
      }
    });
  });
}

function printAccounts() {
  console.log("\nAvailable Accounts\n====================");
  let i = 0;
  for (let key in balances) {
    let str_to_print = `(${i}) ${key} (${balances[key]} ETH)`;
    console.log(str_to_print);
    i++;
  }

  console.log("====================\n")
}

function verifyAccount(publickey, message_hash, signature) {
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

app.get('/balance/:address', (req, res) => {
  const {address} = req.params;
  const balance = balances[address] || 0;
  res.send({ balance });
});

app.post('/send', (req, res) => {
  const {sender, recipient, amount, message_hash, sign_obj} = req.body;
  console.log(req.body);

  if (balances[sender] >= amount) {
    if (!verifyAccount(sender, message_hash, sign_obj['signature'])) {
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

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}!`);
  clientPublisher.publish(CLIENT_CHANNEL, "request-chain");
  requestedUpdate = true;
});

clientSubscriber.on("message", (channel, message) => {
  console.log(`Received message ${message} from channel ${channel}`);

  try {
    message = JSON.parse(message);
  }
  catch {
    // if message is not a JSON string, then just return
    return;
  }

  if (requestedUpdate) {
    if (message["current_chain"] !== undefined) {
      requestedUpdate = false;
      updateBalances(message["current_chain"]);
      printAccounts();
    }
    else {
      clientPublisher.publish(CLIENT_CHANNEL, "request-chain");
    }
  }

  if (message["new_block"] !== undefined) {
    updateBalances(message["new_block"]);
    printAccounts();
  }
});
