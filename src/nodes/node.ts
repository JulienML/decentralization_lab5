import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import { delay } from "../utils";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };
  
  let messages: { [phase: number]: {[k: number]: Value[]}} = {1: {}, 2: {}};

  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  node.post("/message", async (req, res) => {
    if(state.killed) {
      res.status(400).send("Node is stopped");
    }
    else {
      if(!state.decided) {
        let message = req.body.message;

        let phase = message.phase;
        let k = message.k;
        let value = message.value;

        if (!messages[phase][k]) {
          messages[phase][k] = [];
        }
        messages[phase][k].push(value);
      }
      res.status(200).send("Message received");
    }
  });

  async function benOrConsensus() {
    while(!state.decided) {
      if(isFaulty || state.killed || state.k == null || state.x == null) {
        return;
      }
      
      state.k += 1;
      sendMessage(1, state.k, state.x);
      
      // PHASE 1
      // console.log("Phase 1 - Node", nodeId, "k =", state.k, "x =", state.x);
      let receivedMessages;
      do {
        receivedMessages = messages[1][state.k] ? messages[1][state.k] : [];
        await delay(10);
      } while (receivedMessages.filter(v => v != "?").length < N - F);

      let zeroCount = receivedMessages.filter(v => v == 0).length;
      let oneCount = receivedMessages.filter(v => v == 1).length;
      let next_x: Value = "?";
      if (zeroCount > N / 2) {
        next_x = 0;
      }
      else if (oneCount > N / 2) {
        next_x = 1;
      }

      sendMessage(2, state.k, next_x);

      // PHASE 2
      // console.log("Phase 2 - Node", nodeId, "k =", state.k, "x =", state.x);
      do {
        receivedMessages = messages[2][state.k] ? messages[2][state.k] : [];
        await delay(10);
      } while (receivedMessages.length < N - F);

      zeroCount = receivedMessages.filter(v => v == 0).length;
      oneCount = receivedMessages.filter(v => v == 1).length;
      if (zeroCount >= F + 1) {
        state.x = 0;
        state.decided = true;
      }
      else if (oneCount >= F + 1) {
        state.x = 1;
        state.decided = true;
      }
      else {
        if (zeroCount > 0) {
          state.x = 0;
        }
        else if (oneCount > 0) {
          state.x = 1;
        }
        else {
          state.x = Math.random() < 0.5 ? 0 : 1;
        }
      }
    }
  };

  async function sendMessage(
    phase: 1 | 2,
    k: Number,
    x: Value
  ) {
    for (let i = 0; i < N; i++) {
      await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            phase: phase,
            k: k,
            value: x,
          },
        }),
      }).catch(() => {});
    }
  }

  // TODO implement this
  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(10);
    }

    benOrConsensus();

    res.status(200).send("Ben-Or Consensus started");
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send("Node stopped");
  });

  // TODO implement this
  // get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).json(state);
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}