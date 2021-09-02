// https://stackoverflow.com/questions/4124041/is-opengl-coordinate-system-left-handed-or-right-handed

const initAmmo = async function () {
  return await Ammo().then((Ammo) => {
    // For some reason, the inverse() for btTransform in Ammo.js is broken
    // So I'm implementing my own
    // I think it might be due to mat3 x vec3 being broken.
    const inverseTransform = (transform) => {
      const _origin = transform.getOrigin();
      const negativeOrigin = [-_origin.x(), -_origin.y(), -_origin.z()];

      const _transposedBasis = transform.getBasis().transpose();
      const transposedBasis = [];

      // getRow always returns the same pointer
      // just that the value the pointer points to changes
      let _basisRow = _transposedBasis.getRow(0);
      transposedBasis.push(_basisRow.x(), _basisRow.y(), _basisRow.z());

      _basisRow = _transposedBasis.getRow(1);
      transposedBasis.push(_basisRow.x(), _basisRow.y(), _basisRow.z());

      _basisRow = _transposedBasis.getRow(2);
      transposedBasis.push(_basisRow.x(), _basisRow.y(), _basisRow.z());

      const transformedOrigin = Utilities.multiplyMat3ByVec(transposedBasis, negativeOrigin);

      const inverse = new Ammo.btTransform();
      inverse.getOrigin().setValue(...transformedOrigin);
      inverse.getBasis().setValue(...transposedBasis);

      return inverse;
    };

    class PhysicsRigidBody {
      constructor(world, rigidBodyInfo, bones) {
        const {
          shapeType,
          width,
          height,
          depth,
          type,
          weight,
          boneIndex,
          position,
          rotation,
          friction,
          recoil,
          positionDamping,
          rotationDamping,
          groupIndex,
          groupTarget,
        } = rigidBodyInfo;

        let shape;

        if (shapeType === 0) shape = new Ammo.btSphereShape(width);
        if (shapeType === 1) shape = new Ammo.btBoxShape(new Ammo.btVector3(width, height, depth));
        if (shapeType === 2) shape = new Ammo.btCapsuleShape(width, height);

        const localInertia = new Ammo.btVector3();

        if (weight != 0) shape.calculateLocalInertia(weight, localInertia);

        const boneOffsetTransform = new Ammo.btTransform();
        boneOffsetTransform.getOrigin().setValue(position.x, position.y, -position.z);
        boneOffsetTransform.getBasis().setEulerZYX(-rotation.x, -rotation.y, rotation.z);

        const bone = bones[boneIndex];
        const boneTransform = new Ammo.btTransform();
        boneTransform.setIdentity();
        boneTransform.getOrigin().setValue(bone.position.x, bone.position.y, -bone.position.z);

        const rigidBodyTransform = boneTransform.op_mul(boneOffsetTransform);
        const motionState = new Ammo.btDefaultMotionState(rigidBodyTransform);

        const constructionInfo = new Ammo.btRigidBodyConstructionInfo(weight, motionState, shape, localInertia);
        constructionInfo.set_m_friction(friction);
        constructionInfo.set_m_restitution(recoil);

        const rigidBody = new Ammo.btRigidBody(constructionInfo);
        rigidBody.setDamping(positionDamping, rotationDamping);

        if (rigidBodyInfo.type == 0) {
          rigidBody.setCollisionFlags(rigidBody.getCollisionFlags() | 2);
          rigidBody.setActivationState(4);
        }

        world.addRigidBody(rigidBody, 1 << groupIndex, groupTarget);

        this.info = rigidBodyInfo;
        this.rigidBody = rigidBody;
        this.boneOffsetTransform = boneOffsetTransform;
        this.boneOffsetTransformInverse = inverseTransform(boneOffsetTransform);
      }

      preSimulation(motions) {
        const { info, rigidBody, boneOffsetTransform } = this;

        const { position, rotation } = motions[info.boneIndex];

        const _rotation = new Ammo.btQuaternion(-rotation.x, -rotation.y, rotation.z, rotation.w);

        const motionTransform = new Ammo.btTransform();
        motionTransform.getOrigin().setValue(position.x, position.y, -position.z);
        motionTransform.setRotation(_rotation);

        Ammo.destroy(_rotation);

        const transform = motionTransform.op_mul(boneOffsetTransform);

        if (info.type === 2) {
          const rigidBodyTransform = new Ammo.btTransform();
          rigidBody.getMotionState().getWorldTransform(rigidBodyTransform);

          transform.setRotation(rigidBodyTransform.getRotation());

          Ammo.destroy(rigidBodyTransform);
        }

        rigidBody.getMotionState().setWorldTransform(transform);

        Ammo.destroy(transform);
      }

      postSimulation(motions) {
        const { info, rigidBody, boneOffsetTransformInverse } = this;

        const motion = motions[info.boneIndex];

        const transform = new Ammo.btTransform();
        rigidBody.getMotionState().getWorldTransform(transform);
        transform.op_mul(boneOffsetTransformInverse);

        const newRotation = transform.getRotation();
        motion.rotation = [-newRotation.x(), -newRotation.y(), newRotation.z(), newRotation.w()];

        if (info.type === 1) {
          const newPosition = transform.getOrigin();
          motion.position = [newPosition.x(), newPosition.y(), -newPosition.z()];
        }

        Ammo.destroy(transform);
      }
    }

    class PhysicsConstraint {
      constructor(world, joint, bones, rigidBodyObject_1, rigidBodyObject_2) {
        const rigidBody_1 = rigidBodyObject_1.rigidBody;
        const rigidBody_2 = rigidBodyObject_2.rigidBody;

        const rigidBodyInfo_1 = rigidBodyObject_1.info;
        const rigidBodyInfo_2 = rigidBodyObject_2.info;

        if (rigidBodyInfo_1.type !== 0 && rigidBodyInfo_2.type === 2) {
          const { boneIndex: boneIndex_1 } = rigidBodyInfo_1;
          const { boneIndex: boneIndex_2 } = rigidBodyInfo_2;

          if (boneIndex_1 > 0 && boneIndex_2 > 0 && bones[boneIndex_2].parentIndex === boneIndex_1) {
            rigidBodyInfo_2.type = 1;
          }
        }

        const {
          position,
          rotation,
          translationLimit_1,
          translationLimit_2,
          rotationLimit_1,
          rotationLimit_2,
          springPosition,
          springRotation,
        } = joint;

        const transform = new Ammo.btTransform();
        transform.getOrigin().setValue(position.x, position.y, -position.z);
        transform.getBasis().setEulerZYX(-rotation.x, -rotation.y, rotation.z);

        const rigidBodyTransform_1 = rigidBody_1.getWorldTransform();
        const rigidBodyTransform_2 = rigidBody_2.getWorldTransform();

        const rigidBodyTransformInv_1 = inverseTransform(rigidBodyTransform_1);
        const rigidBodyTransformInv_2 = inverseTransform(rigidBodyTransform_2);

        const frameInA = rigidBodyTransformInv_1.op_mul(transform);
        const frameInB = rigidBodyTransformInv_2.op_mul(transform);

        const constraint = new Ammo.btGeneric6DofSpringConstraint(rigidBody_1, rigidBody_2, frameInA, frameInB, true);

        const linearLowerLimit = new Ammo.btVector3(translationLimit_1.x, translationLimit_1.y, -translationLimit_2.z);
        const linearUpperLimit = new Ammo.btVector3(translationLimit_2.x, translationLimit_2.y, -translationLimit_1.z);
        const angularLowerLimit = new Ammo.btVector3(-rotationLimit_2.x, -rotationLimit_2.y, rotationLimit_1.z);
        const angularUpperLimit = new Ammo.btVector3(-rotationLimit_1.x, -rotationLimit_1.y, rotationLimit_2.z);

        constraint.setLinearLowerLimit(linearLowerLimit);
        constraint.setLinearUpperLimit(linearUpperLimit);
        constraint.setAngularLowerLimit(angularLowerLimit);
        constraint.setAngularUpperLimit(angularUpperLimit);

        springPosition.forEach((pos, index) => {
          constraint.enableSpring(index, true);
          constraint.setStiffness(index, pos);
        });

        springRotation.forEach((rot, index) => {
          constraint.enableSpring(index + 3, true);
          constraint.setStiffness(index + 3, rot);
        });

        world.addConstraint(constraint, true);
      }
    }

    class Physics {
      constructor(boneArray, rigidBodyArray, jointArray) {
        const world = this.generateWorld();

        const rigidBodyObjects = rigidBodyArray.map((rigidBody) => {
          if (rigidBody.boneIndex === -1) return;

          return new PhysicsRigidBody(world, rigidBody, boneArray);
        });

        const constraints = jointArray.map((joint) => {
          const { rigidBodyIndex_1, rigidBodyIndex_2 } = joint;

          const rigidBodyObject_1 = rigidBodyObjects[rigidBodyIndex_1];
          const rigidBodyObject_2 = rigidBodyObjects[rigidBodyIndex_2];

          if (!rigidBodyObject_1 || !rigidBodyObject_2) return;

          return new PhysicsConstraint(world, joint, boneArray, rigidBodyObject_1, rigidBodyObject_2);
        });

        this.world = world;
        this.bodies = rigidBodyObjects.filter((o) => o);
        this.constraints = constraints.filter((o) => o);
      }

      generateWorld() {
        const config = new Ammo.btDefaultCollisionConfiguration();
        const dispatcher = new Ammo.btCollisionDispatcher(config);
        const overlappingPairCache = new Ammo.btDbvtBroadphase();
        const solver = new Ammo.btSequentialImpulseConstraintSolver();
        const dynamicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, config);

        dynamicsWorld.setGravity(new Ammo.btVector3(0, -9.8, 0));

        return dynamicsWorld;
      }

      simulateFrame(motions, timeElapsed) {
        var stepTime = timeElapsed / 1000;
        var maxStepNum = 1;
        var unitStep = 1 / 60;

        const newMotions = motions.map((motion) => ({
          position: [...motion.position],
          rotation: [...motion.rotation],
        }));

        this.bodies.forEach((body) => body.preSimulation(newMotions));
        this.world.stepSimulation(stepTime, maxStepNum, unitStep);
        this.bodies.forEach((body) => body.postSimulation(newMotions));

        return newMotions;
      }
    }

    window.Physics = Physics;

    return Physics;
  });
};
