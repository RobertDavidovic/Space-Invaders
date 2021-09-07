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
  levelTime: number;
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
    [defaultAlien, tankAlien, defaultAlien], //level 1
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
      levelTime: 0,
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
  }


    //This Code is lowkey messed so I will explain later
    //Since in Space invaders each row has different aliens each parameter 
    //corresponds to one row of a type of alien to make eg, first row is shooter alien, 2nd row is strong alien ect
    //The function works top to bottom with the new aliens being generated at the top of the canvas and for each parameter 
    //get sent down a step

  const generateBodyRow = (s: State, xCounter: number = 0, yCounter = 0, rowOffset: number, columnOffset: number, verticalStartPos: number, rowSize: number, property: PropertyKey, incrementor: (x: number, offset: number) => number, bodyCreators: BodyCreator[]) => {
    return xCounter == rowSize ? {
        ...s
      } :
      generateBodyRow({
          ...s,
          objCount: s.objCount + 1,
          [property]: (s[property]).concat(bodyCreators[0](s, Constants.AlienStartPoint + incrementor(xCounter, rowOffset), verticalStartPos + (columnOffset * yCounter - 1)))
        }, //This row creates the state with the alien added to it
        xCounter + 1, yCounter, rowOffset, columnOffset, verticalStartPos, rowSize, property, incrementor, bodyCreators)
  } 

  const generateAliens = (s: State, ...f: BodyCreator[]): State => f.length == 0 ? {
    ...s
  } : generateAliens(generateBodyRow(s, 0, f.length, AlienConstants.RowOffset, AlienConstants.ColumnOffset, AlienConstants.VerticalOffset, AlienConstants.RowSize, "aliens", (x, offset) => x * offset, f), ...f.slice(1))


  const shieldIncrementor = (x: number, offset: number) => {

    return x * offset + (60 * Math.floor(x / 3)) + 20
  }
  const generateShields = (s: State, ...f: BodyCreator[]): State => f.length == 0 ? {
    ...s
  } : generateShields(generateBodyRow(s, 0, f.length, Constants.ShieldDistance, 0, Constants.ShieldVerticalPos, 12, "shields", shieldIncrementor, f), ...f.slice(1))

        // check a State for collisions:
    //   bullets destroy rocks spawning smaller ones
    //   ship colliding with rock ends game
    const handleCollisions = (s:State) => {
      const
        playerBullets = s.bullets.filter((a: Body) => a.type == 'player-bullet'),
        bodiesCollided = ([a,b]:[Body,Body]) => collisionDetector(a,b) < a.collisionRadius + b.collisionRadius,

        enemyBullets = s.bullets.filter((b:Body)=>b.type == "enemy-bullet"),
        collidedEnemyBullets = enemyBullets.filter(r=>bodiesCollided([s.ship,r])),
        shipCollidedBullets = collidedEnemyBullets.length > 0,
        shipCollidedAliens = s.aliens.filter(r=>bodiesCollided([s.ship,r])).length > 0,

        
        //Shield Collisions
        allShieldAndEnemyBullets = flatMap(enemyBullets, b=> s.shields.map<[Body,Body]>(r=>([b,r]))),
        collidedShieldsAndBullets = allShieldAndEnemyBullets.filter(bodiesCollided),
        shieldCollidedEnemyBullets = collidedShieldsAndBullets.map(([bullet,_])=>bullet),
        bulletCollidedShields = collidedShieldsAndBullets.map(([_,shield])=>shield),
        
        alienCollidedShields = flatMap(s.shields, b=> s.aliens.map<[Body,Body]>(r=>([b,r]))).filter(bodiesCollided).map(([shield,_])=>shield),
        
        allCollidedShields = alienCollidedShields.concat(bulletCollidedShields),

        //Bullet Alien Collisions
        allPlayerBulletsAndAliens = flatMap(playerBullets, b=> s.aliens.map<[Body,Body]>(r=>([b,r]))),
        collidedBulletsAndAliens = allPlayerBulletsAndAliens.filter(bodiesCollided),
        collidedPlayerBullets = collidedBulletsAndAliens.map(([bullet,_])=>bullet),
        collidedAliens = collidedBulletsAndAliens.map(([_,alien])=>alien),

        //We track this to change scoring depending on which alien is hit
        collidedShooters = collidedAliens.filter((b:Body)=> b.type == "shooter"), 
        collidedBasicAliens = collidedAliens.filter((b:Body)=> b.type == "alien"),
        collidedTankyAliens = collidedAliens.filter((b:Body)=> b.type == "tank" && b.lives == 1),

        allCollidedBullets = [].concat(collidedEnemyBullets,collidedPlayerBullets, shieldCollidedEnemyBullets),


        loweredCollidedShields = allCollidedShields.map((shield:Body) => <Body>{...shield, lives: shield.lives - 1}),
        loweredAliens = collidedAliens.map((alien:Body) => <Body>{...alien, lives: alien.lives - 1})
     // 
      return <State>{
        ...s,
        ship: shipCollidedBullets ? <Body>{...s.ship, lives: s.ship.lives - 1}: s.ship,
        aliens: (cut(s.aliens)(collidedAliens)).concat(loweredAliens),
        bullets: cut(s.bullets)(allCollidedBullets),
        shields: (cut(s.shields)(allCollidedShields)).concat(loweredCollidedShields),
        exit: s.exit.concat(allCollidedBullets,collidedAliens),
        objCount: s.objCount + collidedAliens.length,
        status: shipCollidedAliens? 'loss' : s.status,
        score: s.score + (collidedShooters.length * 3333) + (collidedBasicAliens.length * 1247) + (collidedTankyAliens.length * 4453)
      }
    }


    const checkAlienPosition = (f: (c : number)=> boolean, coordinate: PropertyKey):((s:State)=>boolean) =>{
      const filterCheck = (b:Body)=> f(b[coordinate]);
        return (s:State)=> s.aliens.filter(filterCheck).length > 0
    
  }

  const checkAlienDirection = (s:State) => {
    return checkAlienLeftBound(s) || checkAlienRightBound(s) ? <State>{...s, aliens: s.aliens.map(flipAlienDirection)} : <State>{...s} 
  }

  const checkAlienLeftBound = checkAlienPosition((x) => x < Constants.AlienStartPoint, 'x')
  const checkAlienRightBound = checkAlienPosition((x) => x > Constants.CanvasSize - Constants.AlienStartPoint, 'x')
  const checkAlienBottomBound = checkAlienPosition((y) => y > Constants.CanvasSize - 20, 'y')

  const checkAlienWin = (s:State) => {
    if(checkAlienBottomBound(s) || s.ship.lives <= 0){
      return <State>{...s, status: 'loss'}
    }
    return <State>{...s}
  } 

  const checkBodyLives = (property: PropertyKey) => {
    return (s: State) => {
      const deadBodies = (s[property]).filter((b:Body)=> b.lives <= 0)
      return <State>{...s, [property]: cut(s[property])(deadBodies), exit: s.exit.concat(deadBodies)}
    }
   // const deadShields = s.shields.filter((shield:Body)=> shield.lives <= 0)
  //  return <State>{...s, shields: cut(s.shields)(deadShields), exit: s.exit.concat(deadShields)}
  }
  const checkShieldLives = checkBodyLives("shields")
  const checkEnemeyLives = checkBodyLives("aliens")
  
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
  const handleGameOver = (s:State)=> s.status == 'loss' ? blankState({
    ...s, status: 'loss'}):{...s}

    const tick = (s:State, elapsed:number)=>{
      //Level Maker
      if (s.aliens.length == 0){
        if(s.status == 'playing'){
          if(s.levelFormation.length == 0){
            return <State>{...blankState({...s, status: s.infinite ? 'playing' : 'win'}), ship: s.infinite ? <Body>{...createShip(), lives: s.ship.lives}: {...s.ship, y: -700}}
          }
          return <State> ({
            ...generateShields(generateAliens(s, ...s.levelFormation[0]), [createShield][0]),
            levelFormation: s.levelFormation.slice(1),
            bullets: [],
            exit: s.bullets,
            level: s.level + 1,
            score: s.score + (s.level * 2000)
          })
        }
      }
      const not = <T>(f:(x:T)=>boolean)=>(x:T)=>!f(x),
      expired = (b:Body)=>(elapsed - b.createTime) > 60,
      expiredBullets:Body[] = s.bullets.filter(expired),
      activeBullets = s.bullets.filter(not(expired));

      return pipe(handleGameOver,handleCollisions, checkAlienDirection, checkAlienWin, checkShieldLives, checkEnemeyLives)({
        ...s,
        ship: moveObject(s.ship),
        bullets: activeBullets.map(moveObject),
        aliens: s.aliens.map(moveObject), 
        exit: expiredBullets,
        totalTime: elapsed,
      })
    }
    class Tick { constructor(public readonly elapsed:number) {} }
    class AlienShot { constructor(public readonly chance:number) {} }
    class Move { constructor(public readonly direction:number) {} }
    class StopMoving { constructor(public readonly stopMoving:Directions) {} }
    class Shoot { constructor() {} }
    class Play { constructor(public readonly infinite: Boolean) {} }
     
  //Might remove gameclock
  const 
  keyObservable = <T>(e:Event, k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,e)
      .pipe(
        filter(({code})=>code === k),
        filter(({repeat})=>!repeat),
        map(result)),

    moveLeft = keyObservable('keydown','ArrowLeft',()=>new Move(-4)),
    moveRight = keyObservable('keydown','ArrowRight',()=>new Move(4)),
    stopMoveLeft = keyObservable('keyup','ArrowLeft',()=>new StopMoving('left')),
    stopMoveRight = keyObservable('keyup','ArrowRight',()=>new StopMoving('right')),
    shoot = keyObservable('keydown','Space', ()=>new Shoot())

    const startGame = fromEvent<Event>(playButton, 'click').pipe(map(()=>new Play(false)))
    const startInfinite = fromEvent<Event>(infiniteButton, 'click').pipe(map(()=>new Play(true)))
    //The victim of war
    //spawner = new BehaviorSubject<Spawn>(new Spawn([createAlien, createAlien, createAlien]))
    
    const alienShot = (s: State, chance: number) =>
      chance > s.aliens.filter((a: Body) => a.type == 'shooter').length - 1 ? {...s} : {...s, objCount: s.objCount + 1,bullets: s.bullets.concat(createEnemyBullet(s,s.aliens[chance%s.aliens.length]))}
    
    const generateRandomLevels = (s:State, chance: number)=>
      !s.infinite ? {...s} : <State>{...s, levelFormation: s.levelFormation.length == 0 ? randomLevels[chance % randomLevels.length] : []}
    
    const reduceState = (s:State, e: Move | Tick | StopMoving | Shoot | AlienShot | Play) => 
      e instanceof Move ? {...s,
        ship: {...s.ship, xspeed: e.direction}} : 
        //This ternary checks to see if the player is moving right when the upkey is pressed. If not it returns default state otherwise it sets speed of ship to 0
      e instanceof StopMoving ?  e.stopMoving === 'right' ? 
        s.ship.xspeed > 0 ? {...s, ship: {...s.ship, xspeed: 0}} :  {...s} : 
        /*Below is the same logic as above but if the player is moving to the left*/ 
        s.ship.xspeed < 0 ? {...s,ship: {...s.ship, xspeed: 0}} :  {...s} 
      :
      e instanceof Shoot ? {...s,
        bullets: s.bullets.concat([createPlayerBullet(s, s.ship)]),
        objCount: s.objCount + 1
      }:
      e instanceof AlienShot ? <State>generateRandomLevels(alienShot(s, e.chance), e.chance):
      e instanceof Play ? <State> {...initialState, exit: s.exit.concat(s.aliens, s.bullets, s.shields), infinite: e.infinite ? true : false, levelFormation: e.infinite ?  []: levels}
      :tick(s, e.elapsed)
    ;
  // an instance of the Random Number Generator with a specific seed
  const rng = new RNG(20)
  // return a random number in the range [-1,1]
  const nextRandom = ()=>rng.nextInt() % 100

    // A stream of random numbers
    const randNum$ = interval(100).pipe(map(nextRandom), map((chance) => new AlienShot (chance))) // .pipe(map(nextRandom), map((chance) => new AlienShot (chance))));
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