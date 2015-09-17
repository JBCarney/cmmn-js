'use strict';

var forEach = require('lodash/collection/forEach');

var Refs = require('object-refs');

var elementToString = require('./Util').elementToString;
var is = require('../util/ModelUtil').is;

var diRefs = new Refs({ name: 'cmmnElement', enumerable: true }, { name: 'di' });

function CmmnTreeWalker(handler) {

  // list of elements to handle deferred to ensure
  // prerequisites are drawn
  var deferred = [];

  // list of CMMNEdges which cmmnElementRef is equals null:
  // - it is a connection which does not have a representation
  //   in case plan model
  // - it is a connection between a human (plan item) task and a
  //   discretionary item
  var connections = [];

  ///// Helpers /////////////////////////////////

  function visit(element, ctx) {
    // call handler
    return handler.element(element, ctx);
  }

  function visitRoot(element, diagram) {
    return handler.root(element, diagram);
  }

  function visitIfDi(element, ctx) {
    try {
      return element.di && visit(element, ctx);
    } catch (e) {
      logError(e.message, { element: element, error: e });

      console.error('failed to import ' + elementToString(element));
      console.error(e);
    }
  }

  function logError(message, context) {
    handler.error(message, context);
  }

  ////// DI handling ////////////////////////////

  function registerDi(di) {
    var cmmnElement = di.cmmnElementRef;

    if (cmmnElement) {

      if (cmmnElement.di) {
        logError('multiple DI elements defined for ' + elementToString(cmmnElement), { element: cmmnElement });
      }
      else {
        diRefs.bind(cmmnElement, 'di');
        cmmnElement.di = di;
      }

    }
    else {

      if (di.$instanceOf('cmmndi:CMMNEdge') && di.sourceCMMNElementRef && di.targetCMMNElementRef) {
        connections.push(function (ctx) {
          handleConnection(di, ctx);
        });
      }
      else {
        logError('no cmmnElement referenced in ' + elementToString(di), { element: di });
      }
    }
  }

  function handleConnection(connection, context) {
    visit(connection, context);
  }

  function handleDiagrams(diagrams) {
    forEach(diagrams, handleDiagram);
  }

  function handleDiagram(diagram) {
    handleDiagramElements(diagram.diagramElements);
  }

  function handleDiagramElements(diagramElements) {
    forEach(diagramElements, handleDiagramElement);
  }

  function handleDiagramElement(diagramElement) {
    registerDi(diagramElement);
  }

  ////// Semantic handling //////////////////////

  function handleDefinitions(definitions, diagram) {
    // make sure we walk the correct cmmnElement

    var cmmndi = definitions.CMMNDI;

    // no di -> nothing to import
    if (!cmmndi) {
      return;
    }

    var diagrams = cmmndi.diagrams;


    if (diagram && diagrams.indexOf(diagram) === -1) {
      throw new Error('diagram not part of cmmn:Definitions');
    }

    // no diagrams -> nothing to import
    if (!diagrams || !diagrams.length) {
      return;
    }

    handleDiagrams(diagrams);

    handleCases(definitions.cases);
  }

  function handleCases(cases) {
    forEach(cases, handleCase);
  }

  function handleCase(_case) {
    var casePlanModel = _case.casePlanModel;
    var caseFileModel = _case.caseFileModel;
    
    var di = casePlanModel.di;

    if (!di) {
      return;
    }
    
    var diagram = di.$parent;
    var ctx = visitRoot(_case, diagram);

    if (casePlanModel) {
      ctx = handleCasePlanModel(casePlanModel, ctx);
    }

    if (caseFileModel) {
      handleCaseFileModel(caseFileModel, ctx);
    }

    handleDeferred(deferred, ctx);

    forEach(connections, function(d) { d(ctx); });
  }

  function handleCaseFileModel(caseFileModel, context) {
    forEach(caseFileModel.caseFileItems, function (caseFileItem) {
      handleCaseFileItem(caseFileItem, context);
    });
  }

  function handleCaseFileItem(caseFileItem, context) {
    visitIfDi(caseFileItem, context);
  }

  function handleCasePlanModel(casePlanModel, context) {
    var newCtx = visitIfDi(casePlanModel, context);

    forEach(casePlanModel.exitCriteria, function (criterion) {
      handleCriterion(criterion, newCtx);
    });

    handleStage(casePlanModel, newCtx);

    return newCtx;
  }

  function handleDeferred(deferred, ctx) {
    forEach(deferred, function(d) { d(ctx); });
  }

  function handleStage(stage, context) {
    handlePlanningTable(stage.planningTable, context, stage);
    handlePlanFragments(stage.planItemDefinitions, context);
    handlePlanItems(stage.planItems, context);
  }

  function handlePlanningTable(planningTable, context, referencedByItem) {
    if (planningTable) {
      forEach(planningTable.tableItems, function (tableItem) {
        if (tableItem.$instanceOf('cmmn:DiscretionaryItem')) {
          handleDiscretionaryItem(tableItem, context, referencedByItem);
        }
        else if (tableItem.$instanceOf('cmmn:PlanningTable')) {
          handlePlanningTable(tableItem, context, referencedByItem);
        }
      });
    }
  }

  function handlePlanFragments(planItemDefinitions, context) {
    forEach(planItemDefinitions, function (planItemDefinition) {
      if (is(planItemDefinition, 'cmmn:PlanFragment') && !is(planItemDefinition, 'cmmn:Stage')) {
        handlePlanFragment(planItemDefinition, context);
      }
    });
  }

  function handlePlanFragment(planFragment, context) {
    var newCtx = visitIfDi(planFragment, context);
    handlePlanItems(planFragment.planItems, newCtx);
  }

  function handleDiscretionaryItem(discretionayItem, context, referencedByItem) {
    discretionayItem.referencedByItem = referencedByItem;
    var newCtx = visitIfDi(discretionayItem, context);

    var definitionRef = discretionayItem.definitionRef;
    if (is(definitionRef, 'cmmn:Stage')) {
      handleStage(definitionRef, newCtx);
    }
    else if (is(definitionRef, 'cmmn:HumanTask')) {
      handlePlanningTable(definitionRef.planningTable, context, discretionayItem);
    }
  }

  function handlePlanItems(planItems, context) {
    forEach(planItems, function(planItem) {
      handlePlanItem(planItem, context);
    });
  }

  function handlePlanItem(planItem, context) {
    var newCtx = visitIfDi(planItem, context);

    forEach(planItem.exitCriteria, function (criterion) {
      handleCriterion(criterion, context);
    });

    forEach(planItem.entryCriteria, function (criterion) {
      handleCriterion(criterion, context);
    });

    var definitionRef = planItem.definitionRef;
    if (is(definitionRef, 'cmmn:Stage')) {
      handleStage(definitionRef, newCtx);
    }
    else if (is(definitionRef, 'cmmn:HumanTask')) {
      handlePlanningTable(definitionRef.planningTable, context, planItem); 
    }
  }

  function handleCriterion(criterion, context) {
    visitIfDi(criterion, context);

    if (criterion.sentryRef) {
      forEach(criterion.sentryRef.onParts, function (onPart) {
        deferred.push(function(ctx) {
          handleOnPart(onPart, ctx);
        });
      });
    }
  }

  function handleOnPart(onPart, context) {
    visitIfDi(onPart, context);
  }

  ///// API ////////////////////////////////

  return {
    handleDefinitions: handleDefinitions
  };
}

module.exports = CmmnTreeWalker;