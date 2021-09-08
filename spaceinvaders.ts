import { interval, fromEvent, pipe} from 'rxjs'
import { map, filter, scan, merge} from 'rxjs/operators'

//Here I have defined some types in order to reduce the chances
//of small mistakes being made and to increase readability
type Key = 'ArrowLeft' | 'ArrowRight' | 'Space' | 'w'
type Event = 'keydown' | 'keyup'
type Directions = 'left' | 'right'
type Type = 'ship' | 'bullet' | 'alien' | 'player-bullet' | 'enemy-bullet' | 'shooter' | 'shield' | 'tank'
type GameStatus = 'loss' | 'win' | 'playing'
type BodyCreator = ((state: State, x: number, y: number) => Body)


//Some general constants that are used in the game
const Constants = {
  CanvasSize: 600,
  AlienStartPoint: 50, //The starting x spawn for aliens
  ShieldDistance:25, //How far apart shields are
  ShieldVerticalPos: 500, //Where shields spawn on y axis
  BulletExpirationTime: 60, 
  BulletRadius: 3,
  BulletSpeed: -10,
  StartTime: 0,
  ShipRadius: 20,
  Radius: 10 //The radius of all circle objects that aren't bullets
} as const


//Here are some constants specifically relating to aliens
const AlienConstants = {
  RowSize: 10, //How many aliens in a row
  RowOffset: 35, //The distance between aliens in a row
  ColumnOffset: 35, //The distance between aliens in a column
  VerticalOffset: 40, //The y start pos of the aliens
  DownJumpOffset: 15 //How far they 'jump down' after changing direction
} as const


//This is the game state which is what is outputted from the observable stream
//A state contains all the information from a game interval and from here
//the game is drawn using the updateView function
type State = Readonly<{
  totalTime: number;
  ship: Body;
  aliens: ReadonlyArray<Body>;
  bullets: ReadonlyArray<Body>;
  shields: ReadonlyArray<Body>;
  exit: ReadonlyArray<Body>;
  objCount:number;
  levelFormation: ReadonlyArray<BodyCreator[]>;
  status: GameStatus;
  score: number;
  level: number;
  infinite: boolean;
  randomNumber: number;
}>

//This type is used to reflect the position, movement speed, id...ect
//of all objects in the game
type Body = Readonly<{
  id: string;
  x: number;
  y: number;
  xspeed: number;
  yspeed: number;
  createTime: number;
  type: Type;
  collisionRadius: number;
  lives: number;
}>

//This type stores information used to generate grids. I created this class because
//the original function used to create grids required too many different arguements
//which made the functiond definition hard to read and long to input.
//This was done for readability purposes.
type GridFormation = Readonly<{
  rowOffset:number; //Used to calculate the distance between objects in a row
  columnOffset:number; //The vertical distance between objects in a grid
  verticalStartPoint:number; // The grid y starting point
  horizontalStartPoint: number //The grid x starting point
  rowSize:number; //The number of objects in a row
  stateProperty:string; //The property in the game state where the grid will be stored
  xIncrementor:(x: number, offset: number)=> number; //A function used to determine horizontal distance between objects
}>

//The values used to create an alien grid in the generateBodyRow function
const alienGrid:GridFormation = {
  rowOffset: 35,
  columnOffset: 35,
  verticalStartPoint: 40,
  horizontalStartPoint: Constants.AlienStartPoint,
  rowSize: 10,
  stateProperty: "aliens",
  xIncrementor: (x: number, offset: number) => x * offset
}

/**
   * This function is used to generate the distance between shields in a row
   * When called by generateBodyRow each shield will be combined increments of three
   * with a large gap inbetween them
   * @param x The x position of a shield in a grid
   * @param offset the distance between two shields in a grid (Before any modifications)
   * This allows for the 3x3x3x3 formation imitating the real space invaders
**/
const shieldIncrementor = (x: number, offset: number): number => {
  return x * offset + (60 * Math.floor(x / 3)) + 20
}

//The values used to create a shield grid in the generateBodyRow function
const shieldGrid:GridFormation = {
  rowOffset: 25,
  columnOffset: 0,
  verticalStartPoint: 500,
  horizontalStartPoint: Constants.AlienStartPoint,
  rowSize: 12,
  stateProperty: "shields",
  xIncrementor: shieldIncrementor
}



/**
 * This function is triggered when the window is loaded. Within it it, it
 * contains all the functions using the rxjs library that will be used to output a 
 * stream of states
 */
function spaceinvaders() {
  //Here I get the elements containing player information
  //that is displayed at the top of the svg
  const lives = document.getElementById("lives")
  const score = document.getElementById("score")
  const level = document.getElementById("levels")

  //Here I get all the buttons that will be used to allow
  //the player to restart the game or change modes
  const playButton = document.getElementById("playButton")
  const infiniteButton = document.getElementById("survivalButton")


  /** 
   * createShip is a function that returns a Body.
   * This function is called whenever a state of the game
   * requires a ship with starting values created eg, after restarting the game
   **/
  function createShip(): Body {
    return {
      id: 'ship',
      x: Constants.CanvasSize / 2, //So it spawns in the centre
      y: 550,
      xspeed: 0,
      yspeed: 0,
      createTime: 0,
      type: 'ship',
      collisionRadius: Constants.ShipRadius,
      lives: 3
    }
  }

  /**
   * returns a function that can be used to create a bullet object
   * @param type the Type of the bullet wanting to be made
   * @param direction the number indicating the bullets y speed and direction (+ for down and - for up)
   * @param startOffset the vertical difference between a bullet and it's creator (used so the player can fire the bullet from the tip of triangle)
   * 
   * The function returns another function which returns the bullet<Body>
   * This function has the parameters
   * @param s the current state of the game and is needed to create the id of the bullet
   * @param owner the body that originally fired the bullet
   * 
   * The reason why createBullet is curried is so that types of bullets can be defined 
   * and then afterwards those types of bullets can be assigned to different entities.
   * It makes the code more readable when creating bullets and reduces repetition.
   * It also allows for new features to be made more easily as different bullet 'types' can have
   * their own personal functions that all follow the same blueprint
   */
  function createBullet(type:string, direction: number, startOffset: number = 0) : ((s: State, owner: Body)=>Body){
    return (s: State, owner: Body)=> <Body>{
      id: type + s.objCount,
      x: owner.x,
      y: owner.y + startOffset,
      xspeed: 0,
      yspeed: direction,
      createTime: s.totalTime,
      type: type,
      collisionRadius: Constants.BulletRadius,
    }
  }

  //These two functions are the result of createbullet. 
  //Now that they have their values assigned they just need the game state and
  //the owner
  const createPlayerBullet = createBullet("player-bullet", -10, -20)
  const createEnemyBullet = createBullet("enemy-bullet", 7)


  
    /**
   * returns a function that can be used to create an object in the game
   * @param type the Type of the body to be made
   * @param xSpeed the horizontal movement speed of a Body
   * @param health the number of times a body can be hit before it is removed (1 is default value)
   * 
   * I only included parameters that currently neeeded for the differemt bodies but if needed
   * it can be expanded.
   * 
   * The function returns another function which returns a BodyCreator
   * A BodyCreator is very similar to the inner function curried in createBullet
   * but is used so often that it has it's own type. It is a function used to create
   * objects with type Body, and determines their position
   * This function has the parameters
   * @param s the current state of the game and is needed to create the id of the body
   * @param xPos the x value of a created Body
   * @param yPos the y value of a created Body
   * The reason why createBody is curried is very similar to the reason why bullet was curried.
   * It allows the creation of other functions that can be used to generate different bodies like aliens and shields
   * in a game state. That way when aliens are being created the programmer doesn't need to worry
   * about it's properties, only it's position.
   */
  function createBody(type: Type, xSpeed:number = 2,health: number = 1): BodyCreator{
    return (s:State, xPos: number, yPos: number)=> <Body>{
    id: type + s.objCount,
    x: xPos,
    y: yPos,
    xspeed: xSpeed,
    yspeed: 0,
    createTime: s.totalTime,
    type: type,
    collisionRadius: Constants.Radius,
    lives: health
    }
  }

  //Here are a few functions that return an alien of a specific type
  //All special information is assigned so only position needs to be
  //passed in to create an alien
  const defaultAlien = createBody("alien",2)
  const shooterAlien = createBody("shooter",2)
  const tankAlien = createBody("tank",2,2)
  const createShield = createBody("shield", 0, 3)


  /**
   * Here is a constant that reprenesents the layout of the different levels in a game.
   * Each element in levels in an array containing the functions used to create each alien row of a level.
   * So for example levels[1] will create a level containing a row of default aliens, a row of tanks and a row of shooters
   * The first element in the sub arrays represents the closest alien to the player (ie the row with the lowest y value)
   */
  const levels= [
    [defaultAlien, defaultAlien, tankAlien], //level 1
    [defaultAlien, tankAlien, shooterAlien], //level 2
    [defaultAlien, shooterAlien, defaultAlien, shooterAlien, tankAlien], //level 3
  ]

  /**
   * This constant ultimately holds the same purpose as the levels constant
   * except for random level generation. Each level is wrapped in an array
   * as each element represents a constant like 'levels' but only if it had one level
   */
  const randomLevels = [
    [[defaultAlien, defaultAlien, defaultAlien]],
    [[shooterAlien, defaultAlien, defaultAlien, defaultAlien]],
    [[tankAlien, shooterAlien, defaultAlien, shooterAlien, shooterAlien]],
    [[defaultAlien, shooterAlien, shooterAlien , shooterAlien]],
    [[defaultAlien, shooterAlien, defaultAlien]],
    [[defaultAlien, defaultAlien, defaultAlien, defaultAlien, defaultAlien, defaultAlien, defaultAlien, defaultAlien]],
    [[shooterAlien, tankAlien, defaultAlien, shooterAlien, shooterAlien, defaultAlien]],
    [[tankAlien, tankAlien, shooterAlien, tankAlien, tankAlien]],
    [[shooterAlien, shooterAlien, shooterAlien, shooterAlien, shooterAlien, tankAlien]],
  ]

  /**
   * This state represents an initial state of a game. This is used
   * ranging on purposes like the start of levels, to restarting the game
   */
  const initialState: State = {
      totalTime: 0,
      ship: createShip(),
      aliens: [],
      bullets: [],
      exit: [],
      shields: [],
      objCount: 0,
      levelFormation: levels,
      status: 'playing',
      score: 0,
      level: 0,
      infinite: false,
      randomNumber: 0
  }

/**
 * This function returns a state with an amount of bodies in a row
 * @param s //The initial state before a row is added
 * @param xCounter  //Used to trace the number of bodies added so far in a row and to determine x position
 * @param yCounter  //Used to determine y position
 * @param gridData  //The data needed to construct a row of a grid
 * @param bodyCreators //An array of functions that return a body (This is what's used to actually add the body to a new state)
 * @returns A state with a new row attatched
 * 
 * This function is used to generate a row of bodies. It works by recursively by creating a state with a row of bodies
 * with the type of whatever bodyCreators[0] is. The reason why it accesses the first element in because each element in body creators is
 * representative of one row so the bodies > 0, do not matter. These bodies are in an array to begin with as the parameter is given
 * by a slice method being used by other functiions. To sum it up this function recursively just creates a row of bodies.
 * Most of the logic is used to determine position, size and patterns of a row. It is called by other functions to generate multiple rows.
 * BodyCreators just determines the type of Body that should be created in this row. 
 */
  const generateBodyRow = (s: State, xCounter: number = 0, yCounter = 0,  gridData: GridFormation, bodyCreators: BodyCreator[]) : State => {
    return xCounter == gridData.rowSize ? { //This checks if all the bodies have been added with a new state and returns the state with the row
        ...s 
      } :
      generateBodyRow({ //This is the recursive call used to create the bodies
          ...s, objCount: s.objCount + 1, //A new body is created in one recursion so the object count must be updated

           //[Get the relevant property in x to add a body to]     [Return a state with that body concacted]     [Math used to determine x position of row                         [Math used to determine the y position]
          [gridData.stateProperty]: (s[gridData.stateProperty]).concat(bodyCreators[0](s, gridData.horizontalStartPoint + gridData.xIncrementor(xCounter,gridData.rowOffset), gridData.verticalStartPoint + (gridData.columnOffset * yCounter - 1)))

        },                             
        xCounter + 1, yCounter, gridData, bodyCreators) //Pass in all the values for recursion and increment x by one
  }

  /**
   * This function is used to create a grid of aliens.
   * @param s The current state of the game before the aliens are generator
   * @param f The list of fuctions used to create an aliens in a level
   * @returns a state with a grid of aliens attatched to it
   * It works by recursively calling generate bodyBody row for each element in f
   * with one element representing one row of aliens. It then slices f to
   * pass the 2nd row and onwards... The function stops when there are no more rows that
   * need to be created, indicated by f.length being 0
   */
  const generateAliens = (s: State, ...f: BodyCreator[]): State => f.length == 0 ? {
    ...s
  } : generateAliens(generateBodyRow(s, 0, f.length, alienGrid, f), ...f.slice(1))


/**
 * This function is used to create a row of shields
 * @param s The current state of the game before the aliens are generator
 * @param f The list of fuctions used to create an aliens in a level
 * @returns a state with a row of shields attatched to it
 * This function just calls generateBodyRow with the relevant values attatched to create shields
 */
  const generateShields = (s: State, ...f: BodyCreator[]): State => generateBodyRow(s, 0, f.length, shieldGrid, f)

  /**
   * This function is used to determine the effects of collisions
   * @param s The state of the game to check collisions for
   * @returns A new state where the effects of the collisions are applied to s
   * This is a funnction that is run through a pipe on tick which is used to determine
   * if any collisions occur. Because the function handles collisions it doesn't need
   * any arguements except for the state of the game, as it handles the current state.
   * While some of the logic could be reduced using a function to combine different interactions
   * I decided to seperate them in order to make logic easier to follow and to allow easier expansions
   * of code when trying to modify specific collisions
   */
  const handleCollisions = (s: State) => {
    const
      //This filter creates a list of objects containing the information about all bullets fired by the player
      playerBullets = s.bullets.filter((a: Body) => a.type == 'player-bullet'),
      //Create list of enemy bullets
      enemyBullets = s.bullets.filter((b: Body) => b.type == "enemy-bullet"),
      //This function determines if two bodies have collided 
      bodiesCollided = ([a, b]: [Body, Body]) : Boolean => collisionDetector(a, b) < a.collisionRadius + b.collisionRadius,
      
      //Find any bullets that collided with the playyer using bodiesCollided
      collidedEnemyBullets = enemyBullets.filter(r => bodiesCollided([s.ship, r])),
      //This boolean is used to check if the ship has been hit in this state by an enemy bullet
      shipCollidedBullets = collidedEnemyBullets.length > 0,
      //This determines if the ship has hit any aliens
      shipCollidedAliens = s.aliens.filter(r => bodiesCollided([s.ship, r])).length > 0,

      //Shield Collisions
      allShieldAndEnemyBullets = flatMap(enemyBullets, b => s.shields.map < [Body, Body] > (r => ([b, r]))), //Create two arrays in an array consisting of all enemy bullets and shields
      collidedShieldsAndBullets = allShieldAndEnemyBullets.filter(bodiesCollided), //Create a array of arrays of shields and enemy bullets collided with each other
      shieldCollidedEnemyBullets = collidedShieldsAndBullets.map(([bullet, _]) => bullet), //Create a array of collided shields
      bulletCollidedShields = collidedShieldsAndBullets.map(([_, shield]) => shield), //Create a array of collided bullets

      //Get a list of shields that collided with aliens
      alienCollidedShields = flatMap(s.shields, b => s.aliens.map <[Body, Body]> (r => ([b, r]))).filter(bodiesCollided).map(([shield, _]) => shield), 
      //                                [Get two arrays of all aliens and shields]         [Filter the two arrays to find collided shields]    [Return the shields that have collided]
      allCollidedShields = alienCollidedShields.concat(bulletCollidedShields),

      //Bullet Alien Collisions
      allPlayerBulletsAndAliens = flatMap(playerBullets, b => s.aliens.map < [Body, Body] > (r => ([b, r]))), //Create two arrays in an array consisting of all player bullets and aliens
      collidedBulletsAndAliens = allPlayerBulletsAndAliens.filter(bodiesCollided), //Create a array of arrays of aliens and player bullets collided with each other
      collidedPlayerBullets = collidedBulletsAndAliens.map(([bullet, _]) => bullet), //Create a array of collided player bullets
      collidedAliens = collidedBulletsAndAliens.map(([_, alien]) => alien),//Create a array of collided aliens

      //We track this to change scoring depending on which alien is hit
      collidedShooters = collidedAliens.filter((b: Body) => b.type == "shooter"),
      collidedBasicAliens = collidedAliens.filter((b: Body) => b.type == "alien"),
      collidedTankyAliens = collidedAliens.filter((b: Body) => b.type == "tank" && b.lives == 1), //We only want to count killed tank aliens not wounded collisions

      allCollidedBullets = [].concat(collidedEnemyBullets, collidedPlayerBullets, shieldCollidedEnemyBullets), //Create an array of all bullets collided

      //Create an array of shields containing every shield that was hit with one less life
      loweredCollidedShields = allCollidedShields.map((shield: Body) => < Body > {...shield, lives: shield.lives - 1}), 
      //Create an array of aliens containing every shield that was hit with one less life
      loweredAliens = collidedAliens.map((alien: Body) => < Body > {...alien, lives: alien.lives - 1})
  // 
    return <State>{
      ...s, //Return every value that isn't affected by collisioon in a new state
      ship: shipCollidedBullets ? <Body>{...s.ship, lives: s.ship.lives - 1}: s.ship,  //Determine if the ship was hit by a bullet, if so lower the health of the ship in the next state
      aliens: (cut(s.aliens)(collidedAliens)).concat(loweredAliens), //Remove any aliens that were hit and replace them with almost identical aliens with one less health
      bullets: cut(s.bullets)(allCollidedBullets), //Remove collided bullets
      shields: (cut(s.shields)(allCollidedShields)).concat(loweredCollidedShields),  //Remove any shields that were hit and replace them with almost identical aliens with one less health
      exit: s.exit.concat(allCollidedBullets,collidedAliens), //Add collided aliens and bullet to exit (Aliens to allow for tank color change) 
      status: shipCollidedAliens? 'loss' : s.status, //If the ship hit an alien lose the game
      score: s.score + (collidedShooters.length * 3333) + (collidedBasicAliens.length * 1247) + (collidedTankyAliens.length * 4451) //Add scores depending on which aliens were hit 
                                                                                                                                    //The numbers are designed to make random looking scores because
                                                                                                                                    //I like the aesthetic
    }
  }

  /**
   * This function returns another function that checks if any given alien satisfies the position check
   * @param f //The function used to determine the position check
   * @param coordinate //The property of the body that needs to be checked in f
   * @returns Another function that accepts a boolean and confirms if an alien satifies the position check
   * I created this function as there were multiple positions that needed to be checked for all the aliens in the game
   * and to make the code more consise and allowing the checks to be piped. 
   */
  const checkAlienPosition = (f: (c : number)=> boolean, coordinate: PropertyKey):((s:State)=>boolean) =>{
    const filterCheck = (b:Body)=> f(b[coordinate]); 
      return (s:State)=> s.aliens.filter(filterCheck).length > 0 //Filter any aliens and determine if any of them pass the filter check
  }

  //Below are a list of functions that are piped to the game state in tick to determine any effects
  //of any game states

  //Boolean functions that are used to check all the aliens x directuions in check alien direction
  const checkAlienLeftBound = checkAlienPosition((x) => x < Constants.AlienStartPoint, 'x')
  const checkAlienRightBound = checkAlienPosition((x) => x > Constants.CanvasSize - Constants.AlienStartPoint, 'x')

  /**
   * Returns a state where the the direction of all aliens are flipped
   * @param s the state that needs to be checked for the aliens direction
   * @returns a state with flipped aliens or the current state if no flip is needed
   * It checks if any alien has passed any of the bounds and if so flips trhe aliens. If not
   * return the state inputted
   */
  const checkAlienDirection = (s:State) => {
    return checkAlienLeftBound(s) || checkAlienRightBound(s) ? <State>{...s, aliens: s.aliens.map(flipAlienDirection)} : {...s}
  }

  //Boolean functions used to determine if any aliens have gotten too far down the canvas
  const checkAlienBottomBound = checkAlienPosition((y) => y > Constants.CanvasSize - 20, 'y')

  /**
   * Determine if the player has lost
   * @param s the state of the game needing to be checked
   * @returns a new state with a status of loss or the inputted state
   * It just checks if aliens have gotten too far down or if the player has lost all
   * of their health. If so change the game status and the lives on the player to 0 (incase player lost in way not from health loss)
   */
  const checkAlienWin = (s:State) => {
    if(checkAlienBottomBound(s) || s.ship.lives <= 0){
      return <State>{...s, status: 'loss', ship: {...s.ship, lives: 0}}
    }
    return {...s}
  } 

  /**
   * Creates a function that can be used to check the lives of a body
   * @param property the array of the state that needs to be checked for health
   * @returns a function that has a property to check, with only the gamestate as input
   * This function filters through a given property in a state and determines any bodies with
   * less than 0 health, It then returns a state with those elements removed and added to exit
   */
  const checkBodyLives = (property: PropertyKey) => {
    return (s: State) => {
      const deadBodies = (s[property]).filter((b:Body)=> b.lives <= 0)
      return <State>{...s, [property]: cut(s[property])(deadBodies), exit: s.exit.concat(deadBodies)}
    }
  }

  //These two functions check for 0 lives shields and aliens respectively
  const checkShieldLives = checkBodyLives("shields")
  const checkEnemeyLives = checkBodyLives("aliens")
  
  //A state used to create an empty looking svg for when the game
  //is paused from a game over or win. It is also used to
  //have a placeholder state before a random level is selected
  const blankState = (s:State)=>{return {
    ...s,
    ship: <Body>{...s.ship, y: -700},
    aliens: [],
    bullets: [],
    shields: [],
    exit: s.exit.concat(s.aliens, s.bullets, s.shields),
    objCount: 0,
    levelFormation: [],
    score: s.score,
    level: s.level
  }}

  //const generateRandomLevels = (s:State, chance: number)=>
 // !s.infinite ? {...s} : <State>{...s, levelFormation: s.levelFormation.length == 0 ? randomLevels[chance % randomLevels.length] : []}
   const createInfiniteLevel = (s: State)=> <State>{...s, levelFormation: randomLevels[s.randomNumber* s.totalTime % randomLevels.length], level: s.level + 1}
   
   const createDefaultLevel = (s: State)=> <State>{...s, bullets: [], exit: s.bullets, level: s.level + 1, score: s.score + (s.level * 2000), levelFormation: s.levelFormation.slice(1)}

   const checkForNewLevel = (s: State)=> s.aliens.length == 0 && s.status == 'playing'? generateShields(generateAliens(s.infinite ? createInfiniteLevel(s) : createDefaultLevel(s), ...s.levelFormation[0]), [createShield][0]) : {...s}  

  const checkEndOfDefaultLevel = (s:State) => s.levelFormation.length == 0 && s.status == 'playing' && !s.infinite && s.aliens.length == 0? <State>{...blankState(s), status: 'win'} : {...s}
  /**
   * This checks if there is a game over or won and triggers the blank state to display the game over screen
   * @param s the state to check for a win/loss
   * @returns a blankstate with the status as loss
   * This is what creates the empty screen for the text to appear
   */
  const handleWinLoss = (s:State)=> s.status == 'loss' ? blankState({
    ...s, status: 'loss'}): s.status == 'win'?  ({
    ...s, status: 'win'}): {...s}

  const handleBullets = (s:State)=>{
    const not = <T>(f:(x:T)=>boolean)=>(x:T)=>!f(x),   //This part of the code just checks for expired bullets
    expired = (b:Body)=>(s.totalTime - b.createTime) > 60,
    expiredBullets:Body[] = s.bullets.filter(expired),
    activeBullets = s.bullets.filter(not(expired));
    return {...s, bullets: activeBullets.map(moveObject), exit: expiredBullets,}
  }

  const moveObjects = (s: State) => <State>{...s, aliens: s.aliens.map(moveObject), ship: moveObject(s.ship),}
    /**
     * This function is where the main gameplay loop takes place
     * @param s the state of the game
     * @param elapsed the amount of time taken place 
     * @returns a new state reflective of the end of a gameplay loop and the elapsed time
     * 
     * Tick is where the majority of the gameplay takes place, and proccesses
     * most of the states in the game. It outputs the final state that is eventually called
     * by updateView. Tick essentially is called by the interval 10 observable, where it continously
     * outputs the game state. It recieves the previous state using a scan, and then outputs another
     * state reflective of what should happen in the 10ms called by interval. Eg moving objects,
     * checking for game affects, handling gamelogic ect... This is all done through a large pipe
     * of functions that each output different states onto each other depending on certain state properties. They are all defined above
     */
    const tick = (s:State, elapsed:number)=>{
      return pipe(moveObjects, handleBullets, handleWinLoss, checkEndOfDefaultLevel, checkForNewLevel, handleCollisions, checkAlienDirection, checkAlienWin, checkShieldLives, checkEnemeyLives)({
        ...s,
        totalTime: elapsed,
      })
    }

  //These classes are used by observables streams to each indicate a different event
  //which is then reduced to form one final state. While they are not streams they
  //are all a streams output from an observable. Each class holds a value that conveys more
  //information about the event
  class Tick { constructor(public readonly elapsed:number) {} }  // ---The stream of time used to trigger tick
  class RandomEvent { constructor(public readonly chance:number) {} } //---The stream of random numbers
  class Move { constructor(public readonly direction:number) {} } //---The stream of key presses that allow movement 
  class StopMoving { constructor(public readonly stopMoving:Directions) {} } //---The stream of key presses that stop movement 
  class Shoot { constructor() {} } //---The stream of spacebar presses needed to shoot
  class Play { constructor(public readonly infinite: Boolean) {} } //The stream of button presses for the in game interface
  
  /**
  * This function allows the creation of observables streams from key event presses
  * @param e The keydown or keyup event
  * @param k The key being pressed
  * @param result //An Observable that when subscribed streams the results of keydown or keyup presses
  * This code was created using the asteroids example. It filters all keypresses for the corresponding key
  * and makes sure that the key isn't recorded as repeatidly pressed down. 
  */
  const keyObservable = <T>(e:Event, k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,e)
      .pipe(
        filter(({code})=>code === k),
        filter(({repeat})=>!repeat),
        map(result)),

  //Here are a bunch of observables created by the keyObservable functionm
  moveLeft = keyObservable('keydown','ArrowLeft',()=>new Move(-4)),
  moveRight = keyObservable('keydown','ArrowRight',()=>new Move(4)),
  stopMoveLeft = keyObservable('keyup','ArrowLeft',()=>new StopMoving('left')),
  stopMoveRight = keyObservable('keyup','ArrowRight',()=>new StopMoving('right')),
  shoot = keyObservable('keydown','Space', ()=>new Shoot())
  
  //These two observables correlate to button presses by the two buttons displayed below the svg
  const startGame = fromEvent<Event>(playButton, 'click').pipe(map(()=>new Play(false)))
  const startInfinite = fromEvent<Event>(infiniteButton, 'click').pipe(map(()=>new Play(true)))

  /**
   * This function is used to create enemy bullets
   * @param s The state of the game 
   * @param chance a random number generated by a random stream from 0 to 100
   * @returns A new state where an enemy bullet may be created
   * 
   * This function works by filtering all the aliens to create an array of shooters and then checks to see if
   * the random number is within the bounds of the array. If not no bullet is fired and s is just returned.
   * If the number is within the bounds of the array, the alien at that index gets passed into create EnemyBullet,
   * and a game state is outputted to reflect this new bullet
   */
  const alienShot = (s: State, chance: number) =>
    chance > s.aliens.filter((a: Body) => a.type == 'shooter').length - 1 ? {...s} : {...s, objCount: s.objCount + 1,bullets: s.bullets.concat(createEnemyBullet(s,s.aliens[chance]))}
  
  /**
   * This function just outputs a state that is the same as the input state but with a different random number property
   * @param s the state of the game
   * @param chance the random number
   * @returns a new state of the game that is the same except for it's random number value which is chance
   * This function allows for any random calculations to be made with state
   */
  const generateRandomNumber = (s:State, chance: number)=>
    <State>{...s, randomNumber: chance}
  
  /**
   * Encapsulates all the possible transformations of a state 
   * @param s the state before transformations are applied
   * @param e used to identify different observable streams that are being reduced
   * @returns the reduced state
   * This function is what allows for the different transformations of the code to appear to happen 
   * co-currently. This is because all the different transformations are combined into one final 
   * state that can later be used to create the game. While some observable streams like tick
   * also hold multiple transformations of a state, reduceState is special as it allows for 
   * different streams to be combined into one.
   */
  const reduceState = (s:State, e: Move | Tick | StopMoving | Shoot | RandomEvent | Play) => 
    e instanceof Move ? {...s,
      ship: {...s.ship, xspeed: e.direction}} :      //Set the ships direction based on the left or right key press
    e instanceof StopMoving ?  e.stopMoving === 'right' ? 
      s.ship.xspeed > 0 ? {...s, ship: {...s.ship, xspeed: 0}} :  {...s} : //These two see if the ship should stop moving
      s.ship.xspeed < 0 ? {...s,ship: {...s.ship, xspeed: 0}} :  {...s} 
    :
    e instanceof Shoot ? {...s,
      bullets: s.bullets.concat([createPlayerBullet(s, s.ship)]), //This is called when space is pressed and is what creates the players bullets
      objCount: s.objCount + 1
    }:
    e instanceof RandomEvent ? <State>generateRandomNumber(alienShot(s, e.chance), e.chance): //This changes a states random numbers and calls alien shots
    //Play resets the game state to either infinite mode or regular mode. The states outputted are the starts of levels with some values changed to make it a pure reset
    e instanceof Play ? e.infinite ? createInfiniteLevel({...blankState(s), ship: {...s.ship, lives: 3}, score: 0, level: -1, infinite: true}) : <State>{...initialState, exit: s.exit.concat(s.aliens, s.bullets, s.shields)}
    : tick(s, e.elapsed); //Tick is called to reflect most other transformations in game logic

  // an instance of the Random Number Generator with a specific seed
  const rng = new RNG(20)
  // return a random number in the range [0,100]
  const nextRandom = ()=>rng.nextInt() % 100

    // A stream of random numbers created by mapping interval 100 to nextRandom, and then creating a new observable
    //that can be merged so that it can be reduced
    const randNum$ = interval(100).pipe(map(nextRandom), map((chance) => new RandomEvent (chance)))
    
    /**
     * This observable emits numbers every 10 ms. It is then mapped so that it is a stream
     * of Tick with the time elapsed passed into Tick, which is used for bullet time expiration.
     * It then merges all other observables before scan calls reduce on the stream to output the final state of the
     * game (for a given time interval). Scan originally passes in initialState but every interval it accumulates the next
     * output of the stream leading to the gameplay loop. Finally subscribe is called to turn interval into a stream of states
     * which are passed into updateView to create the graphics for the game using the state/
     */
    interval(10).pipe(
      map(elapsed => new Tick (elapsed)),
      merge(moveLeft, moveRight, stopMoveLeft, stopMoveRight, shoot),
      merge(randNum$),
      merge(startGame, startInfinite),
      scan(reduceState, initialState)
    ).subscribe(updateView)


    function updateView(s:State): void {
      const svg = document.getElementById("canvas")!
      function createText(text: string, colour: string): Element{
        const v = document.createElementNS(svg.namespaceURI, "text")!;
        attr(v,{x:Constants.CanvasSize/3,y:Constants.CanvasSize/2,class:"message", id: "message", fill: colour});
        v.textContent = text;
        svg.appendChild(v);
        return v
      }

      lives.textContent = `Lives: ${s.ship.lives}`;
      score.textContent = `Score: ${s.score}`;
      level.textContent = `Level: ${s.level}`;
      const ship = document.getElementById("ship")!;
      ship.setAttribute('transform',
       `translate(${s.ship.x},${s.ship.y}) rotate(${0})`)
       ship.classList.add(s.ship.type)
       //Adding bullet code
       s.bullets.forEach(b=>{
        const createBulletView = ()=>{
          const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
          v.setAttribute("id",b.id);
          attr(v,{id:b.id,rx:4,ry:4});
          //v.classList.add("bullet")
          v.classList.add(b.type)
          svg.appendChild(v)
          return v;
        }

        

        const v = document.getElementById(b.id) || createBulletView();
        v.setAttribute("cx",String(b.x))
        v.setAttribute("cy",String(b.y))

      })      
      
      const statusText = document.getElementById("message")
      if (!statusText){
        if(s.status == 'loss') {
          createText("Game Over", "red")
         }
         if (s.status == 'win'){
           createText("You've Won!", "white")
         }
      }
      else if (s.status == "playing"){
        svg.removeChild(statusText) 
      }
      //Adding Alien code --Make better later
      s.aliens.forEach(b=>{
        const createAlienView = ()=>{
          const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
          v.setAttribute("id",b.id);
          attr(v,{id:b.id,rx:Constants.Radius,ry:Constants.Radius});
          if(b.type == "tank"){
            v.setAttribute("fill", `rgb(${(b.lives * 70) + 150}, ${(b.lives * 70)+ 50}, ${(b.lives * 10)+ 10})`)
          }
          v.classList.add(b.type)
          svg.appendChild(v)
          return v;
        }
        
        const v = document.getElementById(b.id) || createAlienView();
        v.setAttribute("cx",String(b.x))
        v.setAttribute("cy",String(b.y))
      })
      //Shield
      s.shields.forEach(b=>{
        const createAlienView = ()=>{
          const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
          v.setAttribute("id",b.id);
          attr(v,{id:b.id,rx:Constants.Radius,ry:Constants.Radius});
          //v.classList.add("bullet")
          v.classList.add(b.type)
          svg.appendChild(v)
          return v;
        }
        
        const v = document.getElementById(b.id) || createAlienView();
        v.setAttribute("cx",String(b.x))
        v.setAttribute("cy",String(b.y))
        v.setAttribute("fill", `rgb(${(b.lives * 20) + 95}, ${(b.lives * 20)+ 158}, ${(b.lives * 20)+ 160})`)
      })
    
      s.exit.forEach(o=>{
        const v = document.getElementById(o.id);
        if(v) svg.removeChild(v)
      })
    }
}   
  // the following simply runs your space invaders function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      spaceinvaders();
    }
  

//Object Movement
const moveObject = (o:Body) => <Body> {
  ...o,
  x: torusWrap(o.x + o.xspeed),
  y: o.y + o.yspeed
}

const flipAlienDirection = (o:Body) => <Body>{
  ...o,
  xspeed: -o.xspeed,
  y: o.y + AlienConstants.DownJumpOffset 
}
// Screen Wrapper
const torusWrap = (x: number) : number => { 
  const s=Constants.CanvasSize, 
    wrap = (v:number) => v < 0 ? v + s : v > s ? v - s : v;
  return wrap(x)
}





/**
 * set a number of attributes on an Element at once
 * @param e the Element
 * @param o a property bag
 */         
 const attr = (e:Element,o:Object) =>
 { for(const k in o) e.setAttribute(k,String(o[k])) }


 const collisionDetector = (firstBody:Body, secondBody: Body)=>{
  const x = firstBody.x - secondBody.x;
  const y = firstBody.y - secondBody.y;
  return Math.sqrt(x*x + y*y)
 }

 /**
 * array a except anything in b
 * @param eq equality test function for two Ts
 * @param a array to be filtered
 * @param b array of elements to be filtered out of a
 */ 
  const except = 
    <T>(eq: (_:T)=>(_:T)=>boolean)=>
      (a:ReadonlyArray<T>)=> 
        (b:ReadonlyArray<T>)=> a.filter(not(elem(eq)(b)))

   const cut = except((a:Body)=>(b:Body)=>a.id === b.id)
  /**
 * Composable not: invert boolean result of given function
 * @param f a function returning boolean
 * @param x the value that will be tested with f
 */
  const not = <T>(f:(x:T)=>boolean)=> (x:T)=> !f(x)

  /**
   * is e an element of a using the eq function to test equality?
 * @param eq equality test function for two Ts
 * @param a an array that will be searched
 * @param e an element to search a for
 */
  const elem = 
    <T>(eq: (_:T)=>(_:T)=>boolean)=> 
      (a:ReadonlyArray<T>)=> 
        (e:T)=> a.findIndex(eq(e)) >= 0

  
/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T,U>(
  a:ReadonlyArray<T>,
  f:(a:T)=>ReadonlyArray<U>
): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f));
}

//
class RNG {
  // LCG using GCC's constants
  m = 0x80000000// 2**31
  a = 1103515245
  c = 12345
  state:number
  constructor(seed) {
    this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
  }
  nextInt() {
    this.state = (this.a * this.state + this.c) % this.m;
    return this.state;
  }
  nextFloat() {
    // returns in range [0,1]
    return this.nextInt() / (this.m - 1);
  }
}
//Notes to self, update comments to reflect side effects, add instructions and double check worksheet