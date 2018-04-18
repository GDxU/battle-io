var socket = socketCluster.connect({
        codecEngine: scCodecMinBin
    });

window.onload = function () {

        //  Note that this html file is set to pull down Phaser from our public/ directory.
        //  Although it will work fine with this tutorial, it's almost certainly not the most current version.
        //  Be sure to replace it with an updated version before you start experimenting with adding your own code.
    
    var gameContainer = document.getElementById("game_content")
    var game, playerId, player;
    users = {};
    coins = {};

    var WORLD_WIDTH;
    var WORLD_HEIGHT;
    var WORLD_COLS;
    var WORLD_ROWS;
    var WORLD_CELL_WIDTH;
    var WORLD_CELL_HEIGHT;
    var PLAYER_LINE_OF_SIGHT = Math.round(window.innerWidth);
    var PLAYER_INACTIVITY_TIMEOUT = 700;
    var USER_INPUT_INTERVAL = 20;
    var COIN_INACTIVITY_TIMEOUT = 2200;
    var ENVIRONMENT;
    var SERVER_WORKER_ID;

    var herosTextures = [
      { // bot 0
        up: 'img/bot-back.gif',
        left: 'img/bot-side-left.gif',
        right: 'img/bot-side-right.gif',
        down: 'img/bot-front.gif'
      },
      { // hero 1
        up: 'img/you-back.gif',
        left: 'img/you-side-left.gif',
        right: 'img/you-side-right.gif',
        down: 'img/you-front.gif',
        downAttack: 'img/you-front-attack.gif'
      },
      { // hero 2
        up: 'img/others-back.gif',
        left: 'img/others-side-left.gif',
        right: 'img/others-side-right.gif',
        down: 'img/others-front.gif',
        downAttack: 'img/others-front-attack.gif'
      }
    ];

    // Map the score value to the texture.
    var grassTextures = {
      1: 'img/grass-1.gif',
      2: 'img/grass-2.gif',
      3: 'img/grass-3.gif',
      4: 'img/grass-4.gif'
    };

    // 1 means no smoothing. 0.1 is quite smooth.
    var CAMERA_SMOOTHING = 1;
    var BACKGROUND_TEXTURE = 'img/background-texture.png';

    socket.emit('getWorldInfo', null, function (err, data) {
      WORLD_WIDTH = data.width;
      WORLD_HEIGHT = data.height;
      WORLD_COLS = data.cols;
      WORLD_ROWS = data.rows;
      WORLD_CELL_WIDTH = data.cellWidth;
      WORLD_CELL_HEIGHT = data.cellHeight;
      WORLD_CELL_OVERLAP_DISTANCE = data.cellOverlapDistance;
      SERVER_WORKER_ID = data.serverWorkerId;
      ENVIRONMENT = data.environment;

      channelGrid = new ChannelGrid({
        worldWidth: WORLD_WIDTH,
        worldHeight: WORLD_HEIGHT,
        rows: WORLD_ROWS,
        cols: WORLD_COLS,
        cellOverlapDistance: WORLD_CELL_OVERLAP_DISTANCE,
        exchange: socket
      });

      game = new Phaser.Game(WORLD_WIDTH, WORLD_HEIGHT, Phaser.AUTO, gameContainer, {
        preload: preload,
        create: create,
        render: render,
        update: update
      });
    });

    function preload() {
      keys = {
        up: game.input.keyboard.addKey(Phaser.Keyboard.UP),
        down: game.input.keyboard.addKey(Phaser.Keyboard.DOWN),
        right: game.input.keyboard.addKey(Phaser.Keyboard.RIGHT),
        left: game.input.keyboard.addKey(Phaser.Keyboard.LEFT),
        attack: game.input.keyboard.addKey(Phaser.Keyboard.SPACEBAR)
      };
      
      wasd = {
        up: game.input.keyboard.addKey(Phaser.Keyboard.W),
        down: game.input.keyboard.addKey(Phaser.Keyboard.S),
        right: game.input.keyboard.addKey(Phaser.Keyboard.D),
        left: game.input.keyboard.addKey(Phaser.Keyboard.A),
        attack: game.input.keyboard.addKey(Phaser.Keyboard.K)
      };

      game.load.image('background', BACKGROUND_TEXTURE);

      var count = herosTextures.length;
      var heroId = 0;
      for (var i = 0; i < count; i++) {
        for (var key in herosTextures[i]) {
          if (herosTextures[i].hasOwnProperty(key)) {
            game.load.image(heroId + '-' + key, herosTextures[i][key]);
          }
        }
        heroId++;
      }

      game.load.image('grass-1', grassTextures[1]);
      game.load.image('grass-2', grassTextures[2]);
      game.load.image('grass-3', grassTextures[3]);
      game.load.image('grass-4', grassTextures[4]);
    }

    function handleCellData(stateList) {
      stateList.forEach(function (state) {
        if (state.type == 'player') {
          //console.log('state');
          //console.log(state);
          updateUser(state);
        } else if (state.type == 'coin') {
          if (state.delete) {
            removeCoin(state);
          } else {
            renderCoin(state);
          }
        }
      });
      updatePlayerZIndexes();
    }

    var watchingCells = {};

    /*
      Data channels within our game are divided a grids and we only watch the cells
      which are within our player's line of sight.
      As the player moves around the game world, we need to keep updating the cell subscriptions.
    */
    function updateCellWatchers(playerData, channelName, handler) {
      var options = {
        lineOfSight: PLAYER_LINE_OF_SIGHT
      };
      channelGrid.updateCellWatchers(playerData, channelName, options, handler);
    }

    function updateUserGraphics(user) {
      user.sprite.x = user.x;
      user.sprite.y = user.y;

      if (!user.direction) {
        user.direction = 'down';
      }
      
      if (!user.attack) {
        user.attack = '';
        //console.log("sem attack");
      }
      
      if (!user.heroId) {
        //user.heroId = 0;
        console.log("what??");
      }
      
      user.sprite.loadTexture(user.heroId + '-' + user.direction + user.attack);
      user.label.alignTo(user.sprite, Phaser.BOTTOM_CENTER, 0, 10);
    }

    function moveUser(userId, x, y) {
      var user = users[userId];
      user.x = x;
      user.y = y;
      updateUserGraphics(user);
      user.clientProcessed = Date.now();

      if (user.id == playerId) {
        updateCellWatchers(user, 'cell-data', handleCellData);
      }
    }

    function removeUser(userData) {
      var user = users[userData.id];
      if (user) {
        user.sprite.destroy();
        user.label.destroy();
        delete users[userData.id];
      }
    }

    function createTexturedSprite(options) {
      var sprite = game.add.sprite(0, 0, options.texture);
      sprite.anchor.setTo(0.5);

      return sprite;
    }

    function createUserSprite(userData) {
      var user = {};
      users[userData.id] = user;
      user.id = userData.id;
      user.swid = userData.swid;
      user.name = userData.name;
      user.heroId = userData.heroId;
      if (userData.attack) {
        user.attack = userData.attack;
      } else {
        user.attack = '';
      }

      var textStyle = {
        font: '16px Arial',
        fill: '#666666',
        align: 'center'
      };
      
      user.label = game.add.text(0, 0, user.name, textStyle);
      user.label.anchor.set(0.5);

      user.score = userData.score;
      user.sprite = createTexturedSprite({
        texture: user.heroId + '-' + user.direction
      });

      user.sprite.width = Math.round(userData.diam * 0.73);
      user.sprite.height = userData.diam;
      user.diam = user.sprite.width;

      moveUser(userData.id, userData.x, userData.y);

      if (userData.id == playerId) {
        player = user;
        //game.camera.setSize(window.innerWidth, window.innerHeight);
        //game.camera.follow(user.sprite, null, CAMERA_SMOOTHING, CAMERA_SMOOTHING);
        game.camera.setSize(WORLD_WIDTH, WORLD_HEIGHT);
      }
    }

    function updatePlayerZIndexes() {
      var usersArray = [];
      for (var i in users) {
        if (users.hasOwnProperty(i)) {
          usersArray.push(users[i]);
        }
      }
      usersArray.sort(function (a, b) {
        if (a.y < b.y) {
          return -1;
        }
        if (a.y > b.y) {
          return 1;
        }
        return 0;
      });
      usersArray.forEach(function (user) {
        user.label.bringToTop();
        user.sprite.bringToTop();
      });
    }

    function updateUser(userData) {
      var user = users[userData.id];
      if (user) {
        user.score = userData.score;
        user.direction = userData.direction;
        user.heroId = userData.heroId;
        
        if (!user.direction) {
            user.direction = 'down';
        }
        
        if (userData.attack) {
          user.attack = userData.attack;
        } else {
          user.attack = '';
        }
        
        moveUser(userData.id, userData.x, userData.y);
      } else {
        createUserSprite(userData);
      }
    }

    function removeCoin(coinData) {
      var coinToRemove = coins[coinData.id];
      if (coinToRemove) {
        coinToRemove.sprite.destroy();
        delete coins[coinToRemove.id];
      }
    }

    function renderCoin(coinData) {
      if (coins[coinData.id]) {
        coins[coinData.id].clientProcessed = Date.now();
      } else {
        var coin = coinData;
        coins[coinData.id] = coin;
        coin.sprite = createTexturedSprite({
          texture: 'grass-' + (coinData.t || '1')
        });
        coin.sprite.x = coinData.x;
        coin.sprite.y = coinData.y;
        coin.clientProcessed = Date.now();
      }
    }

    function create() {
      background = game.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'background');
      game.time.advancedTiming = true;
      
      var x_start = (window.innerWidth - WORLD_WIDTH) / 2;
      var y_start = ((window.innerHeight - WORLD_HEIGHT) / 2) - document.getElementById("game-top").innerHeight;
      
      if (x_start < 0) {
        x_start = 0;
      }
      
      if (y_start < 0) {
        y_start = 0;
      }
      
      centerContainer = document.getElementById("center-container");
      centerContainer.style.left = x_start + "px";
      centerContainer.style.top = y_start + "px";
      
      gameContainer.style.width = WORLD_WIDTH + "px";
      gameContainer.style.height = WORLD_HEIGHT + "px";
      
      game.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Generate a random name for the user.
      var playerName = 'user-' + Math.round(Math.random() * 10000);

      function joinWorld() {
        socket.emit('join', {
          name: playerName,
          heroId: 1
        }, function (err, playerData) {
          playerId = playerData.id;
          updateCellWatchers(playerData, 'cell-data', handleCellData);
        });
      }

      function removeAllUserSprites() {
        for (var i in users) {
          if (users.hasOwnProperty(i)) {
            removeUser(users[i]);
          }
        }
      }

      if (socket.state == 'open') {
        joinWorld();
      }
      // For reconnect
      socket.on('connect', joinWorld);
      socket.on('disconnect', removeAllUserSprites);
    }

    var lastActionTime = 0;

    function update() {
      var didAction = false;
      var playerOp = {};
      if (keys.up.isDown || wasd.up.isDown) {
        playerOp.u = 1;
        didAction = true;
      }
      if (keys.down.isDown || wasd.down.isDown) {
        playerOp.d = 1;
        didAction = true;
      }
      if (keys.right.isDown || wasd.right.isDown) {
        playerOp.r = 1;
        didAction = true;
      }
      if (keys.left.isDown || wasd.left.isDown) {
        playerOp.l = 1;
        didAction = true;
      }
      if (keys.attack.isDown || wasd.attack.isDown) {
        playerOp.a = 1;
        didAction = true;
      }
      if (didAction && Date.now() - lastActionTime >= USER_INPUT_INTERVAL) {
        lastActionTime = Date.now();
        // Send the player operations for the server to process.
        socket.emit('action', playerOp);
      }
    }

    function render() {
      var now = Date.now();

      if (ENVIRONMENT == 'dev') {
        game.debug.text('FPS:   ' + game.time.fps, 2, 14, "#00FF00");
        if (player) {
          game.debug.text('Score: ' + player.score, 2, 30, "#00FF00");
        }
      }

      for (var i in users) {
        if (users.hasOwnProperty(i)) {
          var curUser = users[i];
          if (now - curUser.clientProcessed > PLAYER_INACTIVITY_TIMEOUT) {
            removeUser(curUser);
          }
        }
      }

      for (var j in coins) {
        if (coins.hasOwnProperty(j)) {
          var curCoin = coins[j];
          if (now - curCoin.clientProcessed > COIN_INACTIVITY_TIMEOUT) {
            removeCoin(curCoin);
          }
        }
      }
    }
};
