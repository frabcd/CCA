/*
 * ai.js
 * Contains the AI tier configurations and the core "brain" logic
 * for AI-controlled opponents.
 *
 * NEW: This version uses a Utility-Based Scoring System to make decisions,
 * making it far more dynamic and intelligent.
 */

import * as THREE from 'three';

// --- AI Tier Configuration ---
export const AI_TIERS = {
    "Noob": {
        decisionInterval: 3.0,
        energyManagement: 0,
        engagementRange: 10,
        retreatHealth: 0.05,
        aimLag: 0.8,
        aimError: 10,
        aimPrediction: 0.0,
        dodgeChance: 0.1,
        dodgeReaction: 0.75,
        comboExecution: 0.0, // Will never check for smart combos
        counterSkill: 0.0      // Will never check for smart counters
    },
    "Adept": {
        decisionInterval: 1.5,
        energyManagement: 0,
        engagementRange: 15,
        retreatHealth: 0.15,
        aimLag: 0.4,
        aimError: 5,
        aimPrediction: 0.0,
        dodgeChance: 0.3,
        dodgeReaction: 0.4,
        comboExecution: 0.0,
        counterSkill: 0.0
    },
    "Pro": {
        decisionInterval: 0.75,
        energyManagement: 25,
        engagementRange: 20,
        retreatHealth: 0.25,
        aimLag: 0.15,
        aimError: 2,
        aimPrediction: 0.3,
        dodgeChance: 0.6,
        dodgeReaction: 0.2,
        comboExecution: 0.25, // 25% chance to "see" a combo
        counterSkill: 0.1       // 10% chance to "see" a counter
    },
    "Master": {
        decisionInterval: 0.25,
        energyManagement: 50,
        engagementRange: 25,
        retreatHealth: 0.35,
        aimLag: 0.05,
        aimError: 0.5,
        aimPrediction: 0.75,
        dodgeChance: 0.9,
        dodgeReaction: 0.05,
        comboExecution: 0.8,
        counterSkill: 0.75
    },
    "Devil": {
        decisionInterval: 0.0,    // Thinks every frame
        energyManagement: 75,     // Saves energy for perfect ult/combo
        engagementRange: 30,
        retreatHealth: 0.5,
        aimLag: 0.0,              // Perfect aim
        aimError: 0.0,
        aimPrediction: 1.0,
        dodgeChance: 1.0,
        dodgeReaction: 0.0,       // Frame-perfect
        comboExecution: 1.0,      // Always sees combos
        counterSkill: 1.0         // Always sees counters
    }
};

/**
 * The core AI "Brain". This function is called every frame
 * from the Player.update() method if the player is an AI.
 * @param {Player} ai The AI player instance
 * @param {number} delta Time since last frame
 * @param {Player} opponent The human player
 * @param {Array} specialObjects The global list of special objects
 */
export function runAI(ai, delta, opponent, specialObjects) {
    if (!opponent || opponent.isDead || ai.isDead) {
        ai.velocity.set(0, 0, 0); // Stop moving
        return;
    }

    const config = ai.aiConfig;
    const state = ai.aiState;
    const target = opponent; // Target is always the real player
    const dist = ai.mesh.position.distanceTo(target.mesh.position);

    // --- 1. Strategy Module (Periodic) ---
    state.decisionTimer -= delta;
    if (state.decisionTimer <= 0 || config.decisionInterval === 0.0) {
        state.decisionTimer = config.decisionInterval;

        // 1a. Find Best Action (The NEW Brain)
        findBestAction(ai, opponent, config, specialObjects);
        
        // 1b. Set Movement Strategy (can be overridden by findBestAction)
        if (state.strategy !== 'WAITING') { // Don't override a "WAIT" command
            if (ai.hp / ai.maxHp <= config.retreatHealth) {
                state.strategy = 'RETREAT';
            } else if (dist <= config.engagementRange) {
                state.strategy = ai.attackType === 'RANGED' ? 'KITE' : 'ATTACK';
            } else {
                state.strategy = 'CHASE';
            }
        }
    }

    // --- 2. Aiming Module (Every Frame) ---
    let targetPos = target.mesh.position.clone();
    if (Math.random() < config.aimPrediction) {
        const lookAheadTime = (config.aimLag || 0.05) * 3;
        targetPos.add(target.velocity.clone().multiplyScalar(lookAheadTime));
    }
    if (config.aimError > 0) {
        targetPos.x += (Math.random() - 0.5) * config.aimError;
        targetPos.z += (Math.random() - 0.5) * config.aimError;
    }
    const aimVector = new THREE.Vector3().subVectors(targetPos, ai.mesh.position).normalize();
    if (config.aimLag > 0) {
        ai.aimDirection.lerp(aimVector, 1.0 - config.aimLag).normalize();
    } else {
        ai.aimDirection.copy(aimVector);
    }
    
    // --- 3. Movement Module (Every Frame) ---
    const move = new THREE.Vector3();
    let targetSpeed = ai.speed;
    
    if (state.strategy === 'WAITING') {
        targetSpeed = 0; // AI is holding position
    } else {
        switch (state.strategy) {
            case 'RETREAT':
                move.subVectors(ai.mesh.position, target.mesh.position).normalize();
                break;
            case 'ATTACK':
                move.subVectors(target.mesh.position, ai.mesh.position).normalize();
                if (dist < ai.attackRange * 0.8) targetSpeed = 0;
                break;
            case 'KITE':
                if (dist < config.engagementRange * 0.7) {
                    move.subVectors(ai.mesh.position, target.mesh.position).normalize();
                } else if (dist > config.engagementRange * 0.9) {
                    move.subVectors(target.mesh.position, ai.mesh.position).normalize();
                } else {
                    const strafeDir = config.aimLag > 0 ? (Math.random() < 0.5 ? 1 : -1) : 1;
                    move.subVectors(target.mesh.position, ai.mesh.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.PI / 2) * strafeDir).normalize();
                }
                break;
            case 'CHASE':
                move.subVectors(target.mesh.position, ai.mesh.position).normalize();
                break;
        }
    }

    if (move.lengthSq() > 0) {
        ai.velocity.add(move.multiplyScalar(targetSpeed * delta * 20));
    }

    // --- 4. Dodge Module (Reactive) ---
    if (state.dodgeCooldown <= 0 && Math.random() < config.dodgeChance) {
        const projectiles = ai.getOpponentProjectiles();
        let closestProj = null;
        let minDist = 10;
        
        for (const proj of projectiles) {
            if (!proj.mesh) continue;
            const d = proj.mesh.position.distanceTo(ai.mesh.position);
            if (d < minDist) {
                minDist = d;
                closestProj = proj;
            }
        }

        if (closestProj) {
            state.dodgeCooldown = 1.0 / (config.dodgeChance || 0.1);
            setTimeout(() => {
                if (ai.isDead) return;
                const dodgeDir = new THREE.Vector3().crossVectors(closestProj.direction, new THREE.Vector3(0, 1, 0)).normalize();
                if (Math.random() < 0.5) dodgeDir.negate();
                ai.velocity.add(dodgeDir.multiplyScalar(30));
            }, config.dodgeReaction * 1000);
        }
    }
    if (state.dodgeCooldown > 0) state.dodgeCooldown -= delta;
}

/**
 * NEW: The "Brain" - Decides which skill to use based on a scoring system.
 */
function findBestAction(ai, opponent, config, specialObjects) {
    let bestAction = 'basicAttack';
    let maxScore = -100; // Start low

    // Get a list of all affordable, off-cooldown actions
    const availableActions = ['basicAttack', 's1', 's2', 's3', 's4'].filter(key => {
        if (key === 'basicAttack') return ai.cooldowns.basicAttack <= 0;
        const skill = ai.skills[key];
        // Check for energy, cooldown, and AI's own energy management
        return skill && ai.cooldowns[key] <= 0 && ai.energy >= (skill.cost + (ai.energy * (config.energyManagement / 100)));
    });

    // Score each available action
    for (const actionKey of availableActions) {
        const score = calculateSkillScore(actionKey, ai, opponent, config, specialObjects);
        if (score > maxScore) {
            maxScore = score;
            bestAction = actionKey;
        }
    }
    
    // If the best action score is 0 or less, the AI
    // decides to do *nothing* (e.g., wait out Oracle's shield).
    if (maxScore <= 0) {
        ai.aiState.strategy = 'WAITING'; // Tell movement to stop
        return; 
    }

    // Execute the best action
    ai.useSkill(bestAction);
}

// Helper function for the "Brain"
function getSkillScoreByTag(ai, actionKey, tags) {
    if (actionKey === 'basicAttack') return 0; // Basic attacks don't have tags
    const skillTags = ai.skills[actionKey].tags || [];
    for (const tag of tags) {
        if (skillTags.includes(tag)) {
            // Found a match. Give a score.
            // Ults are more valuable
            if (skillTags.includes('ultimate')) return 100;
            return 70; // High priority
        }
    }
    return 0; // No match
}

/**
 * NEW: The "Situational Awareness" - Scores a single skill.
 */
function calculateSkillScore(actionKey, ai, opponent, config, specialObjects) {
    const skill = (actionKey === 'basicAttack') ? {name: 'basicAttack', cost: 0, tags: ['damage']} : ai.skills[actionKey];
    const skillName = skill.name;
    const skillTags = skill.tags || [];

    let score = 0;

    // --- 1. Base Score (What's the skill's general purpose?) ---
    if (skillTags.includes('damage')) score = 15;
    if (skillTags.includes('cc')) score = 20;
    if (skillTags.includes('buff')) score = 25;
    if (skillTags.includes('debuff')) score = 25;
    if (skillTags.includes('defensive')) score = 30;
    if (skillTags.includes('heal')) score = 35;
    if (skillTags.includes('mobility')) score = 10;
    if (skillTags.includes('ultimate')) score = 40; // Ults are a *tool*, not always the best choice
    if (actionKey === 'basicAttack') score = 10; // Basic attack is a low-risk default

    
    // --- 2. Situational Modifiers (This is the "Brain") ---
    
    // A. COUNTER-LOGIC (High reward for smart plays)
    // Check if the AI has the "smarts" to even *look* for counters
    if (Math.random() < config.counterSkill) {
        // IF Opponent is charging (Javelin Laser, Aegis Charge)
        if (opponent.status.isCharging > 0) {
            score += getSkillScoreByTag(ai, actionKey, ['interrupt']); // e.g., Silence
        }
        // IF Opponent is shielded (Oracle Bastion, Aegis Shield)
        if (opponent.status.shielded > 0) {
            score += getSkillScoreByTag(ai, actionKey, ['shield_break']); // e.g., Energy Void
            // If the skill is *just* for damage, it's useless
            if (skillTags.includes('damage') && !skillTags.includes('shield_break')) {
                score = -1; // Make this a "terrible" action
            }
        }
    }

    // B. COMBO-LOGIC (High reward for follow-up)
    // Check if the AI has the "smarts" to look for combos
    if (Math.random() < config.comboExecution) {
        // IF Opponent is vulnerable (rooted, slowed)
        if (opponent.status.rooted > 0 || opponent.status.slowed > 0) {
            score += getSkillScoreByTag(ai, actionKey, ['combo']); // e.g., Laser Core, Pulverize
        }
        // IF We are buffed (e.g., Echo's Overcharge)
        if (ai.status.empowered > 0) {
            score += getSkillScoreByTag(ai, actionKey, ['damage']); // Prioritize all damage
        }
    }
    
    // C. EXECUTE-LOGIC (Win the fight)
    if (opponent.hp / opponent.maxHp < 0.25) { // Opponent is low!
        score += getSkillScoreByTag(ai, actionKey, ['execute']); // e.g., Death Mark
        // Any damage skill is a good finisher
        if (skillTags.includes('damage')) score += 40;
    }

    // D. SELF-PRESERVATION LOGIC (Don't die)
    if (ai.hp / ai.maxHp < 0.3) { // We are low!
        // Prioritize defensive/healing skills
        score += getSkillScoreByTag(ai, actionKey, ['defensive', 'heal', 'shield']);
        // Prioritize escape skills
        score += getSkillScoreByTag(ai, actionKey, ['escape', 'mobility']);
    }

    // E. SPECIAL CASE LOGIC (Character-specific)
    if (ai.characterKey === 'EMPEROR') {
        const soldiers = specialObjects.filter(o => o.constructor.name === 'SandSoldier' && o.owner === ai);
        if (skillName === 'Shifting Sands' && soldiers.length === 0) score = -1; // Can't use
        if (skillName === 'Conquering Sands' && soldiers.length === 0) score = -1; // Useless
    }
    if (ai.characterKey === 'ORACLE') {
        if (skillName === 'Empower' && (ai.status.empowered > 0)) score = -1; // Don't stack
    }

    return score;
}